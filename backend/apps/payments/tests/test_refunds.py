import threading
from decimal import Decimal

import pytest
import stripe
from django.db import connection

from apps.core.errors import Conflict, DomainError
from apps.core.models import AuditLog
from apps.notifications.models import Notification
from apps.payments import services
from apps.payments.models import Refund
from apps.payments.providers.stripe import normalize_event
from tests.factories import make_staff

from .helpers import make_order, make_payment, settle, stripe_event


@pytest.fixture
def staff():
    return make_staff("ADMIN")


def paid_stripe(total_items=(("Beans", "10.00", 1),)):
    order = make_order(payment_method="stripe", items=list(total_items))
    payment = settle(order, "stripe", reference="cs_paid", provider_charge_id="pi_test_123")
    return order, payment


@pytest.mark.django_db
class TestRefundRules:
    def test_partial_then_full_refund_updates_every_mirror(self, staff):
        order = make_order(items=[("Beans", "10.00", 1)])
        payment = settle(order, "demo")
        r1 = services.refund_payment(payment, "2.50", "Spilled", staff)
        payment.refresh_from_db()
        order.refresh_from_db()
        assert r1.status == "SUCCEEDED" and r1.reference.startswith("demo_re_")
        assert (payment.status, payment.refunded_total) == ("PARTIALLY_REFUNDED", Decimal("2.50"))
        assert (order.payment_status, order.refunded_total) == ("PARTIALLY_REFUNDED", Decimal("2.50"))

        r2 = services.refund_payment(payment, services.refundable_amount(payment), "Rest", staff)
        payment.refresh_from_db()
        order.refresh_from_db()
        assert r2.amount == Decimal("7.50")
        assert (payment.status, payment.refunded_total) == ("REFUNDED", Decimal("10.00"))
        assert (order.payment_status, order.refunded_total) == ("REFUNDED", Decimal("10.00"))
        assert Notification.objects.filter(order=order, kind="refund_updated").count() == 2
        entries = AuditLog.objects.filter(action="payment.refund", resource_id=str(payment.pk))
        assert entries.count() == 2 and entries[0].actor == staff

    def test_over_refund_is_rejected_without_a_row(self, staff):
        order = make_order(items=[("Beans", "10.00", 1)])
        payment = settle(order)
        services.refund_payment(payment, "6.00", "x", staff)
        with pytest.raises(Conflict) as exc:
            services.refund_payment(payment, "4.01", "x", staff)
        assert exc.value.detail.code == "refund_exceeds_remaining" and exc.value.extra["remaining"] == "4.00"
        assert Refund.objects.count() == 1

    @pytest.mark.parametrize("amount", ["0", "-1", "abc", None])
    def test_invalid_amounts(self, staff, amount):
        payment = settle(make_order())
        with pytest.raises(DomainError) as exc:
            services.refund_payment(payment, amount, "x", staff)
        assert exc.value.detail.code == "invalid_amount"

    def test_unpaid_payment_cannot_be_refunded(self, staff):
        payment = make_payment(make_order(), "demo", "REQUIRES_ACTION")
        with pytest.raises(Conflict) as exc:
            services.refund_payment(payment, "1.00", "x", staff)
        assert exc.value.detail.code == "payment_not_refundable"

    def test_cash_refund_is_a_recorded_manual_hand_back(self, staff, monkeypatch):
        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: pytest.fail("no provider is contacted for cash"))
        order = make_order(payment_method="cash", items=[("Beans", "10.00", 1)])
        payment = make_payment(order, "cash", "PENDING")
        services.mark_cash_collected(order, staff)
        payment.refresh_from_db()
        refund = services.refund_payment(payment, "4.00", "Wrong item", staff)
        assert refund.status == "SUCCEEDED" and refund.reference == "manual-cash"
        payment.refresh_from_db()
        assert payment.status == "PARTIALLY_REFUNDED"

    def test_cancelling_an_order_does_not_touch_the_payment(self):
        from apps.orders.services import cancel_order

        order = make_order()
        payment = settle(order)
        cancel_order(order.pk, actor="system", reason="x")
        payment.refresh_from_db()
        order.refresh_from_db()
        assert payment.status == "PAID" and order.payment_status == "PAID" and order.refunded_total == 0


@pytest.mark.django_db
class TestStripeRefunds:
    def test_provider_is_called_with_stable_idempotency_and_minor_units(self, staff, monkeypatch):
        order, payment = paid_stripe()
        calls = []
        monkeypatch.setattr(
            stripe.Refund, "create", lambda **kw: calls.append(kw) or {"id": "re_1", "status": "succeeded"}
        )
        refund = services.refund_payment(payment, "3.25", "Late", staff)
        assert refund.status == "SUCCEEDED" and refund.reference == "re_1"
        (call,) = calls
        assert call["payment_intent"] == "pi_test_123" and call["amount"] == 325
        assert call["idempotency_key"] == refund.idempotency_key
        assert call["metadata"]["refund_key"] == refund.idempotency_key

    def test_provider_failure_leaves_everything_unchanged_and_is_retryable(self, staff, monkeypatch):
        order, payment = paid_stripe()
        monkeypatch.setattr(
            stripe.Refund,
            "create",
            lambda **kw: (_ for _ in ()).throw(stripe.APIConnectionError("sk_test secret down")),
        )
        refund = services.refund_payment(payment, "10.00", "Full", staff)
        payment.refresh_from_db()
        order.refresh_from_db()
        assert refund.status == "FAILED" and "sk_test" not in refund.failure_message and refund.failure_message
        assert (payment.status, payment.refunded_total) == ("PAID", 0)
        assert (order.payment_status, order.refunded_total) == ("PAID", 0)
        assert not Notification.objects.filter(order=order, kind="refund_updated").exists()
        assert AuditLog.objects.filter(action="payment.refund_failed").count() == 1
        assert services.refundable_amount(payment) == Decimal("10.00")  # nothing reserved by the failed attempt

        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: {"id": "re_ok", "status": "succeeded"})
        retry = services.refund_payment(payment, "10.00", "Full", staff)
        payment.refresh_from_db()
        assert retry.status == "SUCCEEDED" and retry.pk != refund.pk and payment.status == "REFUNDED"

    def test_unexpected_exception_is_never_reported_as_success(self, staff, monkeypatch):
        order, payment = paid_stripe()

        def explode(**kw):
            raise RuntimeError("socket reset")

        monkeypatch.setattr(stripe.Refund, "create", explode)
        refund = services.refund_payment(payment, "1.00", "x", staff)
        assert refund.status == "FAILED" and "dashboard" in refund.failure_message

    def test_same_idempotency_key_returns_the_original_and_calls_provider_once(self, staff, monkeypatch):
        order, payment = paid_stripe()
        calls = []
        monkeypatch.setattr(
            stripe.Refund, "create", lambda **kw: calls.append(kw) or {"id": "re_1", "status": "succeeded"}
        )
        a = services.refund_payment(payment, "2.00", "x", staff, idempotency_key="click-1")
        b = services.refund_payment(payment, "2.00", "x", staff, idempotency_key="click-1")
        assert a.pk == b.pk and len(calls) == 1
        payment.refresh_from_db()
        assert payment.refunded_total == Decimal("2.00")

    def test_pending_provider_refund_reserves_amount_until_webhook_confirms(self, staff, monkeypatch):
        order, payment = paid_stripe()
        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: {"id": "re_p", "status": "pending"})
        refund = services.refund_payment(payment, "4.00", "x", staff)
        payment.refresh_from_db()
        assert (
            refund.status == "PENDING"
            and payment.refunded_total == 0
            and services.refundable_amount(payment) == Decimal("6.00")
        )
        with pytest.raises(Conflict):
            services.refund_payment(payment, "6.01", "x", staff)

        obj = {
            "id": "re_p",
            "status": "succeeded",
            "amount": 400,
            "currency": "usd",
            "payment_intent": "pi_test_123",
            "metadata": {"refund_key": refund.idempotency_key},
        }
        stored = services.handle_provider_event(
            "stripe", normalize_event(stripe_event("refund.updated", obj, event_id="evt_ru1"))
        )
        refund.refresh_from_db()
        payment.refresh_from_db()
        order.refresh_from_db()
        assert stored.outcome == "applied" and refund.status == "SUCCEEDED"
        assert payment.status == "PARTIALLY_REFUNDED" and order.refunded_total == Decimal("4.00")
        assert Notification.objects.filter(order=order, kind="refund_updated").count() == 1

    def test_refund_failing_later_at_provider_is_reversed(self, staff, monkeypatch):
        order, payment = paid_stripe()
        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: {"id": "re_f", "status": "succeeded"})
        refund = services.refund_payment(payment, "5.00", "x", staff)
        obj = {
            "id": "re_f",
            "status": "failed",
            "amount": 500,
            "currency": "usd",
            "payment_intent": "pi_test_123",
            "failure_reason": "expired_or_canceled_card",
        }
        services.handle_provider_event(
            "stripe", normalize_event(stripe_event("refund.updated", obj, event_id="evt_rf"))
        )
        refund.refresh_from_db()
        payment.refresh_from_db()
        order.refresh_from_db()
        assert refund.status == "FAILED"
        assert (payment.status, payment.refunded_total) == ("PAID", 0) and (
            order.payment_status,
            order.refunded_total,
        ) == ("PAID", 0)

    def test_dashboard_refund_is_reconciled_once_via_charge_refunded(self, monkeypatch):
        order, payment = paid_stripe()
        obj = {"id": "ch_1", "payment_intent": "pi_test_123", "amount_refunded": 300, "currency": "usd"}
        ev = normalize_event(stripe_event("charge.refunded", obj, event_id="evt_cr1"))
        assert services.handle_provider_event("stripe", ev).outcome == "applied"
        payment.refresh_from_db()
        assert payment.refunded_total == Decimal("3.00") and payment.status == "PARTIALLY_REFUNDED"
        # same cumulative total delivered again under a new event id: nothing new to record
        again = normalize_event(stripe_event("charge.refunded", obj, event_id="evt_cr2"))
        assert services.handle_provider_event("stripe", again).outcome == "ignored"
        assert Refund.objects.count() == 1
        bigger = normalize_event(stripe_event("charge.refunded", {**obj, "amount_refunded": 1000}, event_id="evt_cr3"))
        services.handle_provider_event("stripe", bigger)
        payment.refresh_from_db()
        assert payment.status == "REFUNDED" and Refund.objects.get(amount=Decimal("7.00"))

    def test_charge_refunded_for_our_own_in_flight_refund_is_not_double_counted(self, staff, monkeypatch):
        order, payment = paid_stripe()
        existing = Refund.objects.create(
            payment=payment, amount=Decimal("4.00"), status="PENDING", idempotency_key="inflight-1"
        )
        ev = normalize_event(
            stripe_event(
                "charge.refunded",
                {"id": "ch_1", "payment_intent": "pi_test_123", "amount_refunded": 400, "currency": "usd"},
                event_id="evt_race",
            )
        )
        assert services.handle_provider_event("stripe", ev).outcome == "ignored"
        assert Refund.objects.count() == 1 and existing.pk


@pytest.mark.django_db(transaction=True)
class TestRefundConcurrency:
    def test_parallel_full_refunds_cannot_exceed_the_paid_amount(self, staff, monkeypatch):
        order, payment = paid_stripe()
        lock, calls = threading.Lock(), []

        def fake_refund(**kw):
            with lock:
                calls.append(kw)
            return {"id": f"re_{len(calls)}", "status": "succeeded"}

        monkeypatch.setattr(stripe.Refund, "create", fake_refund)
        results, errors = [], []
        barrier = threading.Barrier(5)

        def worker():
            try:
                barrier.wait()
                results.append(services.refund_payment(payment, "10.00", "dup click", staff).status)
            except Conflict as exc:
                errors.append(exc.detail.code)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(5)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        payment.refresh_from_db()
        order.refresh_from_db()
        assert results == ["SUCCEEDED"] and errors == ["refund_exceeds_remaining"] * 4
        assert len(calls) == 1 and Refund.objects.count() == 1
        assert payment.refunded_total == Decimal("10.00") and order.refunded_total == Decimal("10.00")

    def test_parallel_partial_refunds_never_exceed_total(self, staff, monkeypatch):
        order, payment = paid_stripe()
        monkeypatch.setattr(
            stripe.Refund, "create", lambda **kw: {"id": f"re_{kw['idempotency_key'][-6:]}", "status": "succeeded"}
        )
        outcomes = []
        barrier = threading.Barrier(6)

        def worker():
            try:
                barrier.wait()
                outcomes.append(services.refund_payment(payment, "3.00", "x", staff).status)
            except Conflict:
                outcomes.append("rejected")
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        payment.refresh_from_db()
        assert outcomes.count("SUCCEEDED") == 3 and outcomes.count("rejected") == 3
        assert payment.refunded_total == Decimal("9.00") <= payment.amount
