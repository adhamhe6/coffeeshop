"""Order status machine (pure, no I/O).

    PICKUP:    PENDING -> CONFIRMED -> PREPARING -> READY_FOR_PICKUP -> COMPLETED
    DELIVERY:  PENDING -> CONFIRMED -> PREPARING -> OUT_FOR_DELIVERY  -> COMPLETED
    CANCEL:    PENDING | CONFIRMED | PREPARING -> CANCELLED   (COMPLETED and CANCELLED are terminal)

`allowed_transitions` is the pure graph. Business preconditions that depend on other data (e.g. online orders cannot be
confirmed before payment is authorised) live in `apps.orders.services.transition_order` / `blocked_reason`.
"""

from __future__ import annotations

from .models import Order

S = Order.Status
T = Order.Type

PICKUP_FLOW: tuple[str, ...] = (S.PENDING, S.CONFIRMED, S.PREPARING, S.READY_FOR_PICKUP, S.COMPLETED)
DELIVERY_FLOW: tuple[str, ...] = (S.PENDING, S.CONFIRMED, S.PREPARING, S.OUT_FOR_DELIVERY, S.COMPLETED)
TERMINAL: frozenset[str] = frozenset({S.COMPLETED, S.CANCELLED})
CANCELLABLE: frozenset[str] = frozenset({S.PENDING, S.CONFIRMED, S.PREPARING})

STATUS_LABELS = {
    S.PENDING: "Order placed",
    S.CONFIRMED: "Confirmed",
    S.PREPARING: "Preparing",
    S.READY_FOR_PICKUP: "Ready for pickup",
    S.OUT_FOR_DELIVERY: "Out for delivery",
    S.COMPLETED: "Completed",
    S.CANCELLED: "Cancelled",
}


def flow_for(order_type: str) -> tuple[str, ...]:
    return DELIVERY_FLOW if order_type == T.DELIVERY else PICKUP_FLOW


def allowed_transitions_for(order_type: str, status: str) -> list[str]:
    """Statuses reachable from `status` for this order type (forward step first, CANCELLED last)."""
    if status in TERMINAL:
        return []
    flow = flow_for(order_type)
    if status not in flow:
        return []
    nxt = flow[flow.index(status) + 1]
    targets = [str(nxt)]
    if status in CANCELLABLE:
        targets.append(str(S.CANCELLED))
    return targets


def allowed_transitions(order) -> list[str]:
    return allowed_transitions_for(order.order_type, order.status)


def is_terminal(status: str) -> bool:
    return status in TERMINAL


# status -> notification kind (apps.notifications.services.notify_order_event)
NOTIFICATION_KIND = {
    S.CONFIRMED: "order_confirmed",
    S.PREPARING: "order_preparing",
    S.READY_FOR_PICKUP: "order_ready",
    S.OUT_FOR_DELIVERY: "order_out_for_delivery",
    S.COMPLETED: "order_completed",
    S.CANCELLED: "order_cancelled",
}
