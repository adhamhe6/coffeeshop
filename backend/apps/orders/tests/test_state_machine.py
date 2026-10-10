import itertools

import pytest

from apps.accounts.permissions import staff_role
from apps.cart.tests.fixtures import make_order
from apps.core.errors import DomainError
from apps.core.models import AuditLog
from apps.orders import state
from apps.orders.models import Order, OrderStatusHistory
from apps.orders.services import cancel_order, transition_order
from tests.factories import make_staff

pytestmark = pytest.mark.django_db
S = Order.Status

PICKUP_FLOW = ["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "COMPLETED"]
DELIVERY_FLOW = ["PENDING", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "COMPLETED"]
ALL = [s.value for s in S]


def expected_allowed(flow, status):
    if status in ("COMPLETED", "CANCELLED") or status not in flow:
        return set()  # statuses of the other order type's flow have no way forward
    out = {flow[flow.index(status) + 1]}
    if status in ("PENDING", "CONFIRMED", "PREPARING"):
        out.add("CANCELLED")
    return out


@pytest.mark.parametrize(("order_type", "flow"), [("PICKUP", PICKUP_FLOW), ("DELIVERY", DELIVERY_FLOW)])
def test_allowed_transitions_graph(order_type, flow):
    for status in flow + ["CANCELLED"]:
        assert set(state.allowed_transitions_for(order_type, status)) == expected_allowed(flow, status), status
    assert state.flow_for(order_type) == tuple(flow)


def test_allowed_transitions_for_order_instance(shop, customer):
    order = make_order(shop, customer, status="PREPARING", order_type="DELIVERY")
    assert state.allowed_transitions(order) == ["OUT_FOR_DELIVERY", "CANCELLED"]
    order.order_type = "PICKUP"
    assert state.allowed_transitions(order) == ["READY_FOR_PICKUP", "CANCELLED"]


@pytest.mark.parametrize(("order_type", "flow"), [("PICKUP", PICKUP_FLOW), ("DELIVERY", DELIVERY_FLOW)])
def test_full_transition_matrix(shop, customer, order_type, flow):
    """Every (from, to) pair: allowed ones succeed, every other one is refused with 409 invalid_transition."""
    for source, target in itertools.product(ALL, ALL):
        order = make_order(shop, customer, status=source, order_type=order_type, method="cash")
        ok = target in expected_allowed(flow, source)
        if source == target:
            assert transition_order(order.pk, target, actor="system").status == target  # idempotent no-op
            assert OrderStatusHistory.objects.filter(order=order).count() == 0
            continue
        if ok:
            result = transition_order(order.pk, target, actor="system", note="matrix")
            assert result.status == target
            entry = OrderStatusHistory.objects.get(order=order)
            assert (entry.from_status, entry.to_status, entry.actor_label) == (source, target, "system")
        else:
            with pytest.raises(DomainError) as exc:
                transition_order(order.pk, target, actor="system")
            assert exc.value.status_code == 409 and exc.value.detail.code == "invalid_transition", (source, target)
            order.refresh_from_db()
            assert order.status == source


def test_happy_path_sets_timestamps_and_history(shop, customer):
    order = make_order(shop, customer, order_type="PICKUP")
    staff = make_staff("ORDER_MANAGER", branches=[shop.branch])
    for target in PICKUP_FLOW[1:]:
        transition_order(order.pk, target, actor=staff)
    order.refresh_from_db()
    assert order.status == "COMPLETED"
    assert order.confirmed_at is not None and order.completed_at is not None and order.cancelled_at is None
    history = list(OrderStatusHistory.objects.filter(order=order))
    assert [(h.from_status, h.to_status) for h in history] == list(zip(PICKUP_FLOW, PICKUP_FLOW[1:], strict=False))
    assert all(h.actor == staff for h in history) and history[0].actor_label == staff.full_name


def test_staff_transitions_are_audited_system_ones_are_not(shop, customer):
    order = make_order(shop, customer)
    transition_order(order.pk, "CONFIRMED", actor="system", system=True)
    assert not AuditLog.objects.filter(action="order.transition").exists()
    staff = make_staff("ADMIN")
    assert staff_role(staff)
    transition_order(order.pk, "PREPARING", actor=staff, note="go")
    entry = AuditLog.objects.get(action="order.transition")
    assert entry.resource_id == str(order.pk) and entry.actor == staff
    assert entry.changes == {"from": "CONFIRMED", "to": "PREPARING", "note": "go"}


def test_online_order_cannot_be_confirmed_before_payment(shop, customer):
    order = make_order(shop, customer, method="demo", payment_status="PENDING")
    for unpaid in ("PENDING", "REQUIRES_ACTION", "FAILED"):
        Order.objects.filter(pk=order.pk).update(payment_status=unpaid)
        with pytest.raises(DomainError) as exc:
            transition_order(order.pk, "CONFIRMED", actor="system")
        assert exc.value.status_code == 409 and exc.value.detail.code == "payment_required"
    for settled in ("AUTHORIZED", "PAID"):
        Order.objects.filter(pk=order.pk).update(payment_status=settled, status="PENDING")
        assert transition_order(order.pk, "CONFIRMED", actor="system").status == "CONFIRMED"


def test_cash_order_can_be_confirmed_immediately(shop, customer):
    order = make_order(shop, customer, method="cash", payment_status="PENDING")
    assert transition_order(order.pk, "CONFIRMED", actor="system").status == "CONFIRMED"


def test_completing_a_cash_order_does_not_touch_payment_state(shop, customer):
    order = make_order(shop, customer, status="READY_FOR_PICKUP", method="cash")
    transition_order(order.pk, "COMPLETED", actor="system")
    order.refresh_from_db()
    assert order.payment_status == "PENDING"  # collecting cash is payments.mark_cash_collected's job


def test_unknown_status_is_rejected(shop, customer):
    order = make_order(shop, customer)
    with pytest.raises(DomainError) as exc:
        transition_order(order.pk, "TELEPORTED", actor="system")
    assert exc.value.status_code == 400


def test_transition_accepts_order_instance_and_unknown_id_404(shop, customer):
    from rest_framework.exceptions import NotFound

    order = make_order(shop, customer)
    assert transition_order(order, "CONFIRMED", actor="system").status == "CONFIRMED"
    with pytest.raises(NotFound):
        transition_order(99999999, "CONFIRMED", actor="system")


def test_cancel_is_idempotent_and_records_reason(shop, customer):
    order = make_order(shop, customer)
    staff = make_staff("ADMIN")
    cancelled = cancel_order(order.pk, actor=staff, reason="Out of milk")
    assert cancelled.status == "CANCELLED" and cancelled.cancel_reason == "Out of milk" and cancelled.cancelled_at
    again = cancel_order(order.pk, actor=staff, reason="Out of milk")
    assert again.status == "CANCELLED"
    assert OrderStatusHistory.objects.filter(order=order, to_status="CANCELLED").count() == 1
    assert AuditLog.objects.filter(action="order.cancel").count() == 1
    assert transition_order(order.pk, "CANCELLED", actor=staff).status == "CANCELLED"


def test_cancel_by_customer_only_while_pending(shop, customer):
    pending = make_order(shop, customer)
    assert cancel_order(pending.pk, actor=customer, reason="changed my mind", by_customer=True).status == "CANCELLED"
    entry = OrderStatusHistory.objects.get(order=pending)
    assert entry.actor == customer and entry.actor_label == "customer"
    for status in ("CONFIRMED", "PREPARING"):
        order = make_order(shop, customer, status=status)
        with pytest.raises(DomainError) as exc:
            cancel_order(order.pk, actor=customer, by_customer=True)
        assert exc.value.status_code == 409 and exc.value.detail.code == "invalid_transition"
        order.refresh_from_db()
        assert order.status == status
    # staff may still cancel those
    assert cancel_order(order.pk, actor=make_staff("ADMIN"), reason="kitchen fire").status == "CANCELLED"


@pytest.mark.parametrize("status", ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "COMPLETED"])
def test_late_orders_cannot_be_cancelled(shop, customer, status):
    order = make_order(shop, customer, status=status)
    with pytest.raises(DomainError) as exc:
        cancel_order(order.pk, actor="system", reason="x")
    assert exc.value.detail.code == "invalid_transition"


def test_notifications_fire_after_commit_with_the_right_kind(
    shop, customer, monkeypatch, django_capture_on_commit_callbacks
):
    events = []
    monkeypatch.setattr(
        "apps.notifications.services.notify_order_event", lambda order, kind: events.append((order.number, kind))
    )
    order = make_order(shop, customer, order_type="DELIVERY")
    with django_capture_on_commit_callbacks(execute=True):
        for target in DELIVERY_FLOW[1:]:
            transition_order(order.pk, target, actor="system")
    kinds = [k for _, k in events]
    assert kinds == ["order_confirmed", "order_preparing", "order_out_for_delivery", "order_completed"]
    events.clear()
    other = make_order(shop, customer)
    with django_capture_on_commit_callbacks(execute=True):
        cancel_order(other.pk, actor="system", reason="x")
    assert events == [(other.number, "order_cancelled")]


def test_notification_failure_never_breaks_the_transition(
    shop, customer, monkeypatch, django_capture_on_commit_callbacks
):
    def boom(order, kind):
        raise RuntimeError("smtp down")

    monkeypatch.setattr("apps.notifications.services.notify_order_event", boom)
    order = make_order(shop, customer)
    with django_capture_on_commit_callbacks(execute=True):
        assert transition_order(order.pk, "CONFIRMED", actor="system").status == "CONFIRMED"
    order.refresh_from_db()
    assert order.status == "CONFIRMED"


def test_no_notification_when_transition_is_a_noop(shop, customer, monkeypatch, django_capture_on_commit_callbacks):
    events = []
    monkeypatch.setattr("apps.notifications.services.notify_order_event", lambda order, kind: events.append(kind))
    order = make_order(shop, customer, status="CONFIRMED")
    with django_capture_on_commit_callbacks(execute=True):
        transition_order(order.pk, "CONFIRMED", actor="system")
    assert events == []
