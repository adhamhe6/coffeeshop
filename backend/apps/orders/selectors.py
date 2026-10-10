"""Read side of orders: querysets with the right prefetches, the customer-facing timeline and action flags."""

from __future__ import annotations

from django.db.models import Prefetch
from rest_framework.exceptions import NotFound

from . import state
from .models import Order, OrderItem

S = Order.Status


def order_queryset():
    """Orders with everything the list/detail payloads touch (no N+1)."""
    return Order.objects.select_related("branch").prefetch_related(
        Prefetch("items", queryset=OrderItem.objects.select_related("product").prefetch_related("options")),
        "history",
        "payments",
    )


def customer_orders(user):
    return order_queryset().filter(customer=user)


def get_customer_order(user, number: str) -> Order:
    """The customer's own order by number; someone else's (or unknown) is a 404, never a 403."""
    order = customer_orders(user).filter(number=number).first()
    if order is None:
        raise NotFound("Order not found.")
    return order


def history_actor(entry) -> str:
    label = (entry.actor_label or "").lower()
    return label if label in ("customer", "system") else "staff"


def history_payload(order: Order) -> list[dict]:
    out = []
    for entry in order.history.all():
        actor = history_actor(entry)
        out.append(
            {
                "from_status": entry.from_status,
                "to_status": entry.to_status,
                "actor": actor,
                # Notes typed by staff may be internal; customers only see their own and the system's.
                "note": entry.note if actor in ("customer", "system") else "",
                "created_at": entry.created_at,
            }
        )
    return out


def build_timeline(order: Order) -> list[dict]:
    """Steps adapted to PICKUP vs DELIVERY. state: done | current | upcoming | cancelled."""
    flow = state.flow_for(order.order_type)
    reached: dict[str, object] = {}
    for entry in order.history.all():
        reached.setdefault(entry.to_status, entry.created_at)
    reached.setdefault(S.PENDING, order.placed_at)

    def step(status, step_state, at):
        return {"status": str(status), "label": state.STATUS_LABELS[status], "state": step_state, "at": at}

    steps = []
    if order.status == S.CANCELLED:
        steps = [step(st, "done", reached[st]) for st in flow if st in reached]
        steps.append(step(S.CANCELLED, "cancelled", order.cancelled_at or reached.get(S.CANCELLED)))
        return steps
    current = flow.index(order.status)
    for index, st in enumerate(flow):
        if order.status == S.COMPLETED or index < current:
            step_state = "done"
        elif index == current:
            step_state = "current"
        else:
            step_state = "upcoming"
        steps.append(step(st, step_state, reached.get(st)))
    return steps


def can_review(order: Order) -> bool:
    from apps.catalog.models import Review
    from apps.core.models import StoreSettings

    if order.status != S.COMPLETED or not StoreSettings.load().enable_reviews:
        return False
    product_ids = [i.product_id for i in order.items.all() if i.product_id]
    if not product_ids:
        return False
    reviewed = set(
        Review.objects.filter(user_id=order.customer_id, product_id__in=product_ids).values_list(
            "product_id", flat=True
        )
    )
    return any(pid not in reviewed for pid in product_ids)


def actions_for(order: Order) -> dict:
    pending = order.status == S.PENDING
    return {
        "can_cancel": pending,
        "can_pay": (
            pending
            and order.payment_method != "cash"
            and order.total > 0
            and order.payment_status in ("PENDING", "REQUIRES_ACTION", "FAILED")
        ),
        "can_reorder": any(i.product_id for i in order.items.all()),
        "can_review": can_review(order),
    }
