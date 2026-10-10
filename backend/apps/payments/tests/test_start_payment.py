import threading
import time

import pytest
import stripe
from django.db import connection

from apps.core.errors import Conflict, DomainError
from apps.payments import services
from apps.payments.models import Payment

from .helpers import make_order, make_payment, settle

URLS = {"return_url": "https://shop.test/orders/x/confirmation", "cancel_url": "https://shop.test/checkout"}


@pytest.mark.django_db
class TestStartPayment:
    def test_demo_attempt_uses_server_total_and_marks_sandbox(self, settings):
        settings.SITE_URL = "https://shop.test"
        order = make_order(payment_method="demo", items=[("Flat white", "4.50", 3)], tax="1.00")
        start = services.start_payment(order, "demo", **URLS)
        p = start.payment
        assert p.amount == order.total and str(p.amount) == "14.50"
        assert p.currency == "USD" and p.is_sandbox is True and p.provider == "demo"
        assert p.idempotency_key == f"pay-{order.number}-1"
        assert p.reference.startswith("demo_")
        assert start.action == {"type": "redirect", "url": f"https://shop.test/pay/demo/{p.reference}"}
        order.refresh_from_db()
        assert order.payment_status == "REQUIRES_ACTION"

    def test_live_attempt_is_reused_not_duplicated(self):
        order = make_order()
        first = services.start_payment(order, "demo", **URLS)
        second = services.start_payment(order, "demo", **URLS)
        assert first.payment.pk == second.payment.pk
        assert Payment.objects.filter(order=order).count() == 1
        assert second.action == first.action

    def test_retry_after_failure_creates_numbered_attempt(self):
        order = make_order()
        first = services.start_payment(order, "demo", **URLS).payment
        first.status = "FAILED"
        first.save()
        order.payment_status = "FAILED"
        order.save()
        second = services.start_payment(order, "demo", **URLS).payment
        assert second.pk != first.pk
        assert second.idempotency_key == f"pay-{order.number}-2"
        order.refresh_from_db()
        assert order.payment_status == "REQUIRES_ACTION"

    def test_expired_hosted_page_is_not_reused(self):
        from datetime import timedelta

        from django.utils import timezone

        order = make_order()
        p = services.start_payment(order, "demo", **URLS).payment
        Payment.objects.filter(pk=p.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        again = services.start_payment(order, "demo", **URLS).payment
        assert again.pk != p.pk
        p.refresh_from_db()
        assert p.status == "CANCELLED"

    def test_cash_attempt_needs_no_action(self):
        order = make_order(payment_method="cash")
        start = services.start_payment(order, "cash", **URLS)
        assert (
            start.action == {"type": "none"} and start.payment.status == "PENDING" and start.payment.is_sandbox is False
        )
        order.refresh_from_db()
        assert order.payment_status == "PENDING"
        assert services.start_payment(order, "cash", **URLS).payment.pk == start.payment.pk

    @pytest.mark.parametrize("status", ["CANCELLED", "COMPLETED"])
    def test_closed_orders_cannot_be_paid(self, status):
        order = make_order(status=status)
        with pytest.raises(Conflict) as exc:
            services.start_payment(order, "demo", **URLS)
        assert exc.value.detail.code == "order_not_payable"

    def test_settled_orders_cannot_be_paid_again(self):
        order = make_order()
        settle(order)
        with pytest.raises(Conflict) as exc:
            services.start_payment(order, "demo", **URLS)
        assert exc.value.detail.code == "already_paid"

    def test_disabled_provider_is_rejected(self, settings):
        settings.PAYMENT_DEMO_ENABLED = False
        with pytest.raises(DomainError) as exc:
            services.start_payment(make_order(), "demo", **URLS)
        assert exc.value.detail.code == "payment_method_unavailable"
        with pytest.raises(DomainError):
            services.start_payment(make_order(), "paypal", **URLS)

    def test_free_order_has_nothing_to_pay(self):
        order = make_order(items=[("Gift", "0.00", 1)])
        with pytest.raises(Conflict) as exc:
            services.start_payment(order, "demo", **URLS)
        assert exc.value.detail.code == "nothing_to_pay"

    def test_switching_provider_cancels_previous_live_attempt(self, monkeypatch):
        expired = []
        monkeypatch.setattr(stripe.checkout.Session, "expire", lambda sid, **kw: expired.append(sid))
        monkeypatch.setattr(
            stripe.checkout.Session,
            "create",
            lambda **p: {"id": "cs_new", "url": "https://checkout.stripe.test/cs_new"},
        )
        order = make_order(payment_method="stripe")
        old = make_payment(
            order, "stripe", "REQUIRES_ACTION", reference="cs_old", action_url="https://checkout.stripe.test/cs_old"
        )
        order.payment_status = "REQUIRES_ACTION"
        order.save()
        services.start_payment(order, "demo", **URLS)
        old.refresh_from_db()
        assert old.status == "CANCELLED" and expired == ["cs_old"]


@pytest.mark.django_db
class TestStartStripe:
    def test_creates_hosted_session_and_stores_url(self, monkeypatch):
        seen = {}

        def fake_create(**params):
            seen.update(params)
            return stripe.checkout.Session.construct_from(
                {
                    "id": "cs_test_abc",
                    "url": "https://checkout.stripe.test/cs_test_abc",
                    "expires_at": int(time.time()) + 4000,
                },
                "k",
            )

        monkeypatch.setattr(stripe.checkout.Session, "create", fake_create)
        order = make_order(payment_method="stripe", items=[("Beans", "18.00", 1)])
        start = services.start_payment(order, "stripe", **URLS)
        assert start.action == {"type": "redirect", "url": "https://checkout.stripe.test/cs_test_abc"}
        assert start.payment.reference == "cs_test_abc" and start.payment.is_sandbox  # test-mode key
        assert seen["idempotency_key"] == start.payment.idempotency_key
        assert seen["success_url"] == URLS["return_url"]
        # a second call reuses the live hosted session: Stripe is not called again
        monkeypatch.setattr(stripe.checkout.Session, "create", lambda **p: pytest.fail("must reuse"))
        assert services.start_payment(order, "stripe", **URLS).payment.pk == start.payment.pk

    def test_provider_outage_is_reported_and_recorded(self, monkeypatch):
        def boom(**_):
            raise stripe.APIConnectionError("network down")

        monkeypatch.setattr(stripe.checkout.Session, "create", boom)
        order = make_order(payment_method="stripe")
        with pytest.raises(DomainError) as exc:
            services.start_payment(order, "stripe", **URLS)
        assert exc.value.status_code == 502 and exc.value.detail.code == "payment_provider_unavailable"
        attempt = Payment.objects.get(order=order)
        assert attempt.status == "FAILED" and attempt.failure_code == "provider_unreachable"
        order.refresh_from_db()
        assert order.payment_status == "FAILED" and order.status == "PENDING"


@pytest.mark.django_db(transaction=True)
class TestStartConcurrency:
    def test_parallel_requests_share_one_attempt(self):
        order = make_order()
        results, errors = [], []

        def worker():
            try:
                results.append(services.start_payment(order, "demo", **URLS).payment.pk)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors
        assert len(set(results)) == 1
        assert Payment.objects.filter(order=order).count() == 1
        assert Payment.objects.get(order=order).status == "REQUIRES_ACTION"
