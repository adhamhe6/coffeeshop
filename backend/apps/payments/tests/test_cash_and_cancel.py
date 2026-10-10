import threading

import pytest
import stripe
from django.db import connection

from apps.core.errors import Conflict
from apps.core.models import AuditLog
from apps.notifications.models import Notification
from apps.payments import services
from apps.payments.models import Payment
from tests.factories import make_staff

from .helpers import make_order, make_payment, settle


@pytest.mark.django_db
class TestCashCollected:
    def test_pending_cash_payment_becomes_paid(self):
        staff = make_staff("BRANCH_MANAGER")
        order = make_order(payment_method="cash", status="CONFIRMED")
        pending = make_payment(order, "cash", "PENDING")
        payment = services.mark_cash_collected(order, staff)
        order.refresh_from_db()
        assert payment.pk == pending.pk and payment.status == "PAID" and payment.paid_at
        assert order.payment_status == "PAID" and order.status == "CONFIRMED"
        assert AuditLog.objects.filter(action="payment.cash_collected", actor=staff).count() == 1
        assert Notification.objects.filter(order=order, kind="payment_confirmed").count() == 1

    def test_is_idempotent(self):
        staff = make_staff("ADMIN")
        order = make_order(payment_method="cash")
        first = services.mark_cash_collected(order, staff)
        second = services.mark_cash_collected(order, staff)
        assert first.pk == second.pk and Payment.objects.filter(order=order).count() == 1
        assert AuditLog.objects.filter(action="payment.cash_collected").count() == 1
        assert Notification.objects.filter(kind="payment_confirmed").count() == 1

    def test_does_not_confirm_or_complete_the_order(self, store_settings):
        store_settings.auto_confirm_paid_orders = True
        store_settings.save()
        order = make_order(payment_method="cash")
        services.mark_cash_collected(order, make_staff("ADMIN"))
        order.refresh_from_db()
        assert order.status == "PENDING"

    def test_only_cash_orders(self):
        with pytest.raises(Conflict) as exc:
            services.mark_cash_collected(make_order(payment_method="demo"), make_staff("ADMIN"))
        assert exc.value.detail.code == "not_cash_order"

    def test_cancelled_orders_collect_nothing(self):
        order = make_order(payment_method="cash", status="CANCELLED")
        with pytest.raises(Conflict) as exc:
            services.mark_cash_collected(order, make_staff("ADMIN"))
        assert exc.value.detail.code == "order_cancelled"
        assert not Payment.objects.filter(order=order, status="PAID").exists()

    def test_refund_of_collected_cash_is_manual(self):
        staff = make_staff("ADMIN")
        order = make_order(payment_method="cash")
        payment = services.mark_cash_collected(order, staff)
        refund = services.refund_payment(payment, payment.amount, "Customer unhappy", staff)
        payment.refresh_from_db()
        assert refund.reference == "manual-cash" and payment.status == "REFUNDED"


@pytest.mark.django_db(transaction=True)
class TestCashConcurrency:
    def test_parallel_collects_settle_once(self):
        staff = make_staff("ADMIN")
        order = make_order(payment_method="cash")
        errors = []
        barrier = threading.Barrier(5)

        def worker():
            try:
                barrier.wait()
                services.mark_cash_collected(order, staff)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(5)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors, errors
        assert Payment.objects.filter(order=order).count() == 1
        assert Payment.objects.get(order=order).status == "PAID"
        assert Notification.objects.filter(order=order, kind="payment_confirmed").count() == 1
        assert AuditLog.objects.filter(action="payment.cash_collected").count() == 1


@pytest.mark.django_db
class TestCancelOpenPayments:
    def test_closes_live_attempts_and_expires_the_hosted_page(self, monkeypatch):
        expired = []
        monkeypatch.setattr(stripe.checkout.Session, "expire", lambda sid, **kw: expired.append(sid))
        order = make_order(payment_method="stripe", payment_status="REQUIRES_ACTION")
        live = make_payment(order, "stripe", "REQUIRES_ACTION", reference="cs_live")
        failed = make_payment(order, "stripe", "FAILED", reference="cs_failed")
        assert services.cancel_open_payments(order) == 1
        live.refresh_from_db()
        failed.refresh_from_db()
        order.refresh_from_db()
        assert live.status == "CANCELLED" and failed.status == "FAILED" and expired == ["cs_live"]
        assert order.payment_status == "FAILED"  # latest remaining attempt failed; nothing is "in progress" any more

    def test_never_touches_settled_payments(self):
        order = make_order()
        paid = settle(order)
        assert services.cancel_open_payments(order) == 0
        paid.refresh_from_db()
        assert paid.status == "PAID"

    def test_provider_error_when_expiring_is_swallowed(self, monkeypatch):
        def boom(*a, **k):
            raise stripe.APIConnectionError("down")

        monkeypatch.setattr(stripe.checkout.Session, "expire", boom)
        order = make_order(payment_method="stripe", payment_status="REQUIRES_ACTION")
        make_payment(order, "stripe", "REQUIRES_ACTION", reference="cs_live")
        assert services.cancel_open_payments(order) == 1

    def test_late_payment_on_cancelled_order_is_flagged_for_refund(self):
        """If a customer still manages to pay a cancelled order, the books say PAID and staff see needs_refund."""
        from apps.orders.services import cancel_order

        from .helpers import demo_event

        order = make_order()
        attempt = services.start_payment(
            order, "demo", return_url="https://a.test/", cancel_url="https://a.test/"
        ).payment
        cancel_order(order.pk, actor="system", reason="x")
        services.cancel_open_payments(order)  # C1 runs this on commit
        attempt.refresh_from_db()
        assert attempt.status == "CANCELLED"
        stored = services.handle_provider_event("demo", demo_event(attempt, "success"))
        attempt.refresh_from_db()
        assert stored.outcome == "applied" and attempt.status == "PAID"


@pytest.mark.django_db
class TestReconcileTask:
    def _open(self, minutes_old, reference="cs_rec"):
        from datetime import timedelta

        from django.utils import timezone

        order = make_order(payment_method="stripe", payment_status="REQUIRES_ACTION")
        p = make_payment(order, "stripe", "REQUIRES_ACTION", reference=reference)
        Payment.objects.filter(pk=p.pk).update(created_at=timezone.now() - timedelta(minutes=minutes_old))
        return p

    def test_settles_attempts_whose_webhook_was_lost(self, monkeypatch):
        from apps.payments.tasks import reconcile_open_payments

        from .helpers import session_object

        p = self._open(30)
        monkeypatch.setattr(
            stripe.checkout.Session,
            "retrieve",
            lambda sid, **kw: stripe.checkout.Session.construct_from(session_object(p), "k"),
        )
        assert reconcile_open_payments() == 1
        p.refresh_from_db()
        assert p.status == "PAID"
        assert reconcile_open_payments() == 0  # settled attempts are no longer swept

    def test_skips_fresh_attempts_and_survives_provider_errors(self, monkeypatch):
        from apps.payments.tasks import reconcile_open_payments

        fresh = self._open(1, "cs_fresh")
        broken = self._open(30, "cs_broken")
        # the default test fixture already blocks Stripe: the sweep must log and carry on
        assert reconcile_open_payments() == 1
        fresh.refresh_from_db()
        broken.refresh_from_db()
        assert fresh.status == broken.status == "REQUIRES_ACTION"
