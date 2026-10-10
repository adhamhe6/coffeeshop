import threading
from dataclasses import replace
from decimal import Decimal

import pytest
from django.db import IntegrityError, connection, transaction

from apps.notifications.models import Notification
from apps.orders.models import Order, OrderStatusHistory
from apps.payments import services
from apps.payments.models import Payment, PaymentEvent

from .helpers import demo_event, make_order, make_payment, settle

URLS = {"return_url": "https://shop.test/ok", "cancel_url": "https://shop.test/no"}


def live_demo_payment(**order_kw):
    order = make_order(payment_method="demo", **order_kw)
    return services.start_payment(order, "demo", **URLS).payment


def kinds(order):
    return sorted(Notification.objects.filter(order=order).values_list("kind", flat=True))


@pytest.mark.django_db
class TestPaid:
    def test_paid_event_settles_payment_and_order_once(self):
        payment = live_demo_payment()
        stored = services.handle_provider_event("demo", demo_event(payment, "success"))
        payment.refresh_from_db()
        order = payment.order
        order.refresh_from_db()
        assert stored.outcome == "applied" and stored.payment_id == payment.pk and stored.processed_at
        assert payment.status == "PAID" and payment.paid_at is not None
        assert order.payment_status == "PAID" and order.status == "PENDING"  # no auto-confirm by default
        assert kinds(order) == ["payment_confirmed"]

    def test_auto_confirm_uses_the_order_state_machine(self, store_settings):
        store_settings.auto_confirm_paid_orders = True
        store_settings.save()
        payment = live_demo_payment()
        services.handle_provider_event("demo", demo_event(payment, "success"))
        order = payment.order
        order.refresh_from_db()
        assert order.status == "CONFIRMED" and order.confirmed_at is not None
        last = OrderStatusHistory.objects.filter(order=order).latest("id")
        assert (last.to_status, last.actor_label) == ("CONFIRMED", "system")

    def test_cash_orders_are_never_auto_confirmed_by_payment_events(self, store_settings):
        store_settings.auto_confirm_paid_orders = True
        store_settings.save()
        order = make_order(payment_method="cash")
        payment = services.start_payment(order, "cash", **URLS).payment
        services.mark_cash_collected(order, None)
        order.refresh_from_db()
        assert payment.pk and order.status == "PENDING" and order.payment_status == "PAID"

    def test_replays_are_noops_with_duplicate_outcome(self):
        payment = live_demo_payment()
        event = demo_event(payment, "success")
        first = services.handle_provider_event("demo", event)
        outcomes = [services.handle_provider_event("demo", event).outcome for _ in range(5)]
        assert first.outcome == "applied" and outcomes == ["duplicate"] * 5
        assert PaymentEvent.objects.filter(provider="demo").count() == 1
        assert PaymentEvent.objects.get().outcome == "applied"  # the replay did not overwrite history
        assert kinds(payment.order) == ["payment_confirmed"]

    def test_paid_on_a_cancelled_order_is_recorded_but_not_confirmed_or_announced(self):
        payment = live_demo_payment()
        Order.objects.filter(pk=payment.order_id).update(status="CANCELLED")
        stored = services.handle_provider_event("demo", demo_event(payment, "success"))
        payment.refresh_from_db()
        assert stored.outcome == "applied" and payment.status == "PAID"
        assert kinds(payment.order) == []

    def test_unknown_reference_is_ignored_not_an_error(self):
        payment = live_demo_payment()
        stored = services.handle_provider_event(
            "demo", demo_event(payment, "success", reference="demo_nope", payment_id=None, id="x1")
        )
        assert stored.outcome == "ignored" and stored.payment_id is None

    def test_provider_scoping(self):
        payment = live_demo_payment()
        stored = services.handle_provider_event("stripe", demo_event(payment, "success"))
        assert stored.outcome == "ignored"
        payment.refresh_from_db()
        assert payment.status == "REQUIRES_ACTION"


@pytest.mark.django_db
class TestNeverTrustMismatches:
    @pytest.mark.parametrize(
        "override",
        [{"amount": Decimal("0.01")}, {"amount": Decimal("999.00")}, {"currency": "EUR"}, {"amount": None}],
    )
    def test_amount_or_currency_mismatch_never_marks_paid(self, override):
        payment = live_demo_payment()
        stored = services.handle_provider_event("demo", demo_event(payment, "success", **override))
        payment.refresh_from_db()
        payment.order.refresh_from_db()
        assert stored.outcome == "error" and "mismatch" in stored.error
        assert (
            payment.status == "REQUIRES_ACTION"
            and payment.flagged_reason == "amount_mismatch"
            and payment.paid_at is None
        )
        assert payment.order.payment_status == "REQUIRES_ACTION"
        assert kinds(payment.order) == []

    def test_pending_async_status_is_not_paid(self):
        payment = live_demo_payment()
        stored = services.handle_provider_event("demo", demo_event(payment, "success", status="pending", id="p1"))
        payment.refresh_from_db()
        assert stored.outcome == "ignored" and payment.status == "REQUIRES_ACTION"


@pytest.mark.django_db
class TestMonotonicStates:
    def test_late_failure_after_paid_is_out_of_order_and_ignored(self):
        payment = live_demo_payment()
        services.handle_provider_event("demo", demo_event(payment, "success"))
        stored = services.handle_provider_event("demo", demo_event(payment, "decline"))
        payment.refresh_from_db()
        payment.order.refresh_from_db()
        assert stored.outcome == "out_of_order"
        assert payment.status == "PAID" and payment.order.payment_status == "PAID"
        assert kinds(payment.order) == ["payment_confirmed"]

    def test_late_cancel_after_paid_is_out_of_order(self):
        payment = live_demo_payment()
        services.handle_provider_event("demo", demo_event(payment, "success"))
        assert services.handle_provider_event("demo", demo_event(payment, "cancel")).outcome == "out_of_order"
        payment.refresh_from_db()
        assert payment.status == "PAID"

    def test_failure_keeps_order_pending_and_allows_retry_that_succeeds_exactly_once(self):
        payment = live_demo_payment()
        services.handle_provider_event("demo", demo_event(payment, "decline"))
        order = payment.order
        order.refresh_from_db()
        payment.refresh_from_db()
        assert payment.status == "FAILED" and payment.failure_code == "demo_declined" and payment.failure_message
        assert (order.status, order.payment_status) == ("PENDING", "FAILED")
        assert kinds(order) == ["payment_failed"]

        retry = services.start_payment(order, "demo", **URLS).payment
        assert retry.pk != payment.pk
        services.handle_provider_event("demo", demo_event(retry, "success"))
        services.handle_provider_event("demo", demo_event(retry, "success"))
        order.refresh_from_db()
        assert order.payment_status == "PAID"
        assert Payment.objects.filter(order=order, status="PAID").count() == 1
        assert kinds(order) == ["payment_confirmed", "payment_failed"]

    def test_failed_attempt_can_still_be_paid_by_a_verified_event(self):
        """Stripe lets the customer retry a declined card inside the same Checkout Session."""
        payment = live_demo_payment()
        services.handle_provider_event("demo", demo_event(payment, "decline"))
        stored = services.handle_provider_event("demo", demo_event(payment, "success"))
        payment.refresh_from_db()
        assert stored.outcome == "applied" and payment.status == "PAID" and payment.failure_message == ""

    def test_cancel_event_closes_the_attempt_and_resets_order_mirror(self):
        payment = live_demo_payment()
        stored = services.handle_provider_event("demo", demo_event(payment, "cancel"))
        payment.refresh_from_db()
        payment.order.refresh_from_db()
        assert stored.outcome == "applied" and payment.status == "CANCELLED"
        assert payment.order.payment_status == "PENDING" and kinds(payment.order) == []

    def test_second_failure_is_ignored(self):
        payment = live_demo_payment()
        services.handle_provider_event("demo", demo_event(payment, "decline"))
        assert services.handle_provider_event("demo", demo_event(payment, "decline", id="other")).outcome == "ignored"
        assert kinds(payment.order) == ["payment_failed"]

    def test_failure_of_superseded_attempt_does_not_disturb_order(self):
        order = make_order()
        old = services.start_payment(order, "demo", **URLS).payment
        services.handle_provider_event("demo", demo_event(old, "decline"))
        new = services.start_payment(order, "demo", **URLS).payment
        stored = services.handle_provider_event("demo", demo_event(new, "decline", id="n"))
        assert stored.outcome == "applied"
        order.refresh_from_db()
        assert order.payment_status == "FAILED"


@pytest.mark.django_db
class TestDoubleSettlement:
    def test_second_paid_payment_is_flagged_not_settled(self):
        order = make_order(payment_method="demo")
        first = settle(order)
        second = make_payment(order, "demo", "REQUIRES_ACTION", reference="demo_second")
        stored = services.handle_provider_event("demo", demo_event(second, "success"))
        first.refresh_from_db()
        second.refresh_from_db()
        assert stored.outcome == "error" and "refunded" in stored.error
        assert first.status == "PAID"
        assert second.status == "CANCELLED" and second.flagged_reason == "duplicate_charge" and second.paid_at
        assert Payment.objects.filter(order=order, status__in=services.SETTLED).count() == 1
        assert services.refundable_amount(second) == second.amount  # staff can hand the money back

    def test_database_constraint_blocks_two_settled_payments(self):
        order = make_order()
        settle(order)
        with pytest.raises(IntegrityError), transaction.atomic():
            make_payment(order, "demo", "PAID")

    def test_constraint_violation_inside_handler_is_recorded_as_error(self, monkeypatch):
        """Even if the application pre-check is bypassed (a race), the DB constraint still wins."""
        from django.db.models import QuerySet

        order = make_order()
        settle(order)
        second = make_payment(order, "demo", "REQUIRES_ACTION", reference="demo_race")
        real_exists, hidden = QuerySet.exists, {"done": False}

        def blind_once(self):  # hide the existing settlement from the pre-check only
            if not hidden["done"] and self.model is Payment and '"status" IN' in str(self.query):
                hidden["done"] = True
                return False
            return real_exists(self)

        monkeypatch.setattr(QuerySet, "exists", blind_once)
        stored = services.handle_provider_event("demo", demo_event(second, "success"))
        second.refresh_from_db()
        assert hidden["done"] and stored.outcome == "error"
        assert second.status == "CANCELLED" and second.flagged_reason == "duplicate_charge"
        assert Payment.objects.filter(order=order, status="PAID").count() == 1


@pytest.mark.django_db(transaction=True)
class TestConcurrentDelivery:
    def test_six_concurrent_duplicates_apply_once(self):
        payment = live_demo_payment()
        event = demo_event(payment, "success")
        outcomes, errors = [], []
        barrier = threading.Barrier(6)

        def worker():
            try:
                barrier.wait()
                outcomes.append(services.handle_provider_event("demo", event).outcome)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors, errors
        assert sorted(outcomes) == ["applied"] + ["duplicate"] * 5
        assert PaymentEvent.objects.count() == 1
        assert Notification.objects.filter(order=payment.order, kind="payment_confirmed").count() == 1
        payment.refresh_from_db()
        assert payment.status == "PAID"

    def test_distinct_events_for_the_same_payment_settle_once(self):
        """Webhook and return-page sync racing with different event ids still produce one side effect."""
        payment = live_demo_payment()
        events = [demo_event(payment, "success", id=f"e{i}") for i in range(5)]
        outcomes, errors = [], []
        barrier = threading.Barrier(5)

        def worker(ev):
            try:
                barrier.wait()
                outcomes.append(services.handle_provider_event("demo", ev).outcome)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(e,)) for e in events]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors, errors
        assert outcomes.count("applied") == 1 and outcomes.count("ignored") == 4
        assert Notification.objects.filter(order=payment.order, kind="payment_confirmed").count() == 1

    def test_paid_and_failed_racing_never_regress(self):
        payment = live_demo_payment()
        paid, failed = demo_event(payment, "success"), replace(demo_event(payment, "decline"))
        errors = []
        barrier = threading.Barrier(2)

        def worker(ev):
            try:
                barrier.wait()
                services.handle_provider_event("demo", ev)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(e,)) for e in (paid, failed)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors, errors
        payment.refresh_from_db()
        # Either order is legal; what must hold is that money-taken evidence wins: PAID is final.
        assert payment.status == "PAID"
