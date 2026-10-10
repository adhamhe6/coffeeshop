"""Staff order queries: annotations, the documented "stuck" rules, search and branch-timezone-aware date filters.

STUCK RULES (minutes). An order is *stuck* when it has sat in a state longer than staff should let it:
  - unpaid online order still PENDING            > 30 min since placed   (payment never completed)
  - paid online order still PENDING              > 15 min since payment  (nobody accepted it)
  - CONFIRMED                                    > 20 min in that status
  - PREPARING                                    > 45 min in that status
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import django_filters as df
from django.db.models import Count, F, IntegerField, Min, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.accounts.permissions import scope_queryset_by_branch
from apps.branches.models import Branch
from apps.payments.models import Payment

from .models import Order, OrderItem, OrderStatusHistory

S = Order.Status

STUCK_UNPAID_ONLINE_MIN = 30
STUCK_PAID_PENDING_MIN = 15
STUCK_CONFIRMED_MIN = 20
STUCK_PREPARING_MIN = 45
STUCK_RULES = {
    "unpaid_online_pending": STUCK_UNPAID_ONLINE_MIN,
    "paid_still_pending": STUCK_PAID_PENDING_MIN,
    "confirmed": STUCK_CONFIRMED_MIN,
    "preparing": STUCK_PREPARING_MIN,
}
UNPAID_STATUSES = ("PENDING", "REQUIRES_ACTION", "FAILED")
PAID_STATUSES = ("PAID", "AUTHORIZED")
ACTIVE_STATUSES = (S.PENDING, S.CONFIRMED, S.PREPARING, S.READY_FOR_PICKUP, S.OUT_FOR_DELIVERY)
SETTLED_PAYMENT_STATUSES = ("AUTHORIZED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED")


def admin_orders(user):
    """Orders the staff member may see (branch scoped) with list annotations."""
    qs = scope_queryset_by_branch(Order.objects.all(), user, "branch_id")
    return annotate(qs.select_related("branch"))


def annotate(qs):
    last_entry = OrderStatusHistory.objects.filter(order=OuterRef("pk"), to_status=OuterRef("status")).order_by(
        "-created_at", "-id"
    )
    paid_at = Payment.objects.filter(order=OuterRef("pk"), status__in=SETTLED_PAYMENT_STATUSES).values("paid_at")[:1]
    item_total = (
        OrderItem.objects.filter(order=OuterRef("pk"))
        .order_by()
        .values("order")
        .annotate(n=Sum("quantity"))
        .values("n")
    )
    return qs.annotate(
        status_since=Coalesce(Subquery(last_entry.values("created_at")[:1]), F("placed_at")),
        paid_at=Subquery(paid_at),
        item_count=Coalesce(Subquery(item_total, output_field=IntegerField()), 0),
    ).annotate(paid_since=Coalesce(F("paid_at"), F("updated_at")))


def stuck_q(now=None) -> Q:
    now = now or timezone.now()
    return (
        Q(
            status=S.PENDING,
            payment_status__in=UNPAID_STATUSES,
            placed_at__lt=now - timedelta(minutes=STUCK_UNPAID_ONLINE_MIN),
        )
        & ~Q(payment_method="cash")
        | Q(
            status=S.PENDING,
            payment_status__in=PAID_STATUSES,
            paid_since__lt=now - timedelta(minutes=STUCK_PAID_PENDING_MIN),
        )
        | Q(status=S.CONFIRMED, status_since__lt=now - timedelta(minutes=STUCK_CONFIRMED_MIN))
        | Q(status=S.PREPARING, status_since__lt=now - timedelta(minutes=STUCK_PREPARING_MIN))
    )


def minutes_since(moment, now=None) -> int:
    return max(int(((now or timezone.now()) - moment).total_seconds() // 60), 0) if moment else 0


def attention(order, now=None) -> dict | None:
    """Why staff should look at this order, as {code, message}; mirrors `stuck_q` plus refund follow-ups."""
    now = now or timezone.now()
    paid_since = getattr(order, "paid_since", None) or order.updated_at
    status_since = getattr(order, "status_since", None) or order.placed_at
    if order.status == S.PENDING and order.payment_method != "cash" and order.payment_status in UNPAID_STATUSES:
        age = minutes_since(order.placed_at, now)
        if age > STUCK_UNPAID_ONLINE_MIN:
            return {"code": "payment_not_completed", "message": f"Online payment still not completed after {age} min."}
    if order.status == S.PENDING and order.payment_status in PAID_STATUSES:
        age = minutes_since(paid_since, now)
        if age > STUCK_PAID_PENDING_MIN:
            return {"code": "paid_not_accepted", "message": f"Paid {age} min ago but not accepted yet."}
    if order.status == S.CONFIRMED and minutes_since(status_since, now) > STUCK_CONFIRMED_MIN:
        return {
            "code": "confirmed_too_long",
            "message": f"Confirmed {minutes_since(status_since, now)} min ago, still not being prepared.",
        }
    if order.status == S.PREPARING and minutes_since(status_since, now) > STUCK_PREPARING_MIN:
        return {"code": "preparing_too_long", "message": f"Preparing for {minutes_since(status_since, now)} min."}
    if order.status == S.CANCELLED and order.payment_status in ("PAID", "PARTIALLY_REFUNDED"):
        return {
            "code": "refund_needed",
            "message": "Cancelled after payment; the customer has not been fully refunded.",
        }
    return None


def is_stuck(order, now=None) -> bool:
    found = attention(order, now)
    return bool(found and found["code"] != "refund_needed")


def queue_stats(qs, now=None) -> dict:
    """One SQL aggregate per call: count, oldest `status_since` and stuck count for every active status."""
    now = now or timezone.now()
    rows = (
        qs.filter(status__in=ACTIVE_STATUSES)
        .order_by()
        .values("status")
        .annotate(count=Count("id"), oldest=Min("status_since"), stuck=Count("id", filter=stuck_q(now)))
    )
    return {r["status"]: r for r in rows}


# ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def _branch_timezones() -> list[str]:
    return list(Branch.objects.order_by().values_list("timezone", flat=True).distinct())


def _local_midnight(day, tz_name: str) -> datetime:
    return datetime.combine(day, time.min, tzinfo=ZoneInfo(tz_name))


class AdminOrderFilter(df.FilterSet):
    q = df.CharFilter(method="filter_q", help_text="Order number (prefix/contains), customer name, email or phone.")
    status = df.CharFilter(
        method="filter_status", help_text="One or more statuses (repeat the parameter or comma-separate)."
    )
    payment_status = df.CharFilter(method="filter_payment_status", help_text="One or more payment statuses.")
    branch = df.NumberFilter(field_name="branch_id")
    order_type = df.ChoiceFilter(choices=Order.Type.choices)
    payment_method = df.CharFilter(field_name="payment_method")
    date_from = df.DateFilter(
        method="filter_date_from", help_text="Placed on/after this day in the order's branch time zone."
    )
    date_to = df.DateFilter(
        method="filter_date_to", help_text="Placed on/before this day in the order's branch time zone."
    )
    stuck = df.BooleanFilter(method="filter_stuck", help_text="true = orders over the documented time limits.")

    class Meta:
        model = Order
        fields: list[str] = []

    def filter_q(self, qs, name, value):
        value = value.strip()
        if not value:
            return qs
        return qs.filter(
            Q(number__icontains=value)
            | Q(customer_email__icontains=value)
            | Q(customer_name__icontains=value)
            | Q(customer_phone__icontains=value)
        )

    def _multi(self, name: str, choices) -> list[str]:
        raw = [part.strip().upper() for v in self.data.getlist(name) for part in v.split(",") if part.strip()]
        valid = {c[0] for c in choices}
        bad = [v for v in raw if v not in valid]
        if bad:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({name: [f"Unknown value(s): {', '.join(bad)}."]})
        return raw

    def filter_status(self, qs, name, value):
        values = self._multi("status", Order.Status.choices)
        return qs.filter(status__in=values) if values else qs

    def filter_payment_status(self, qs, name, value):
        values = self._multi("payment_status", Order.PaymentStatus.choices)
        return qs.filter(payment_status__in=values) if values else qs

    def _per_timezone(self, qs, day, *, start: bool):
        cond = Q()
        for tz_name in _branch_timezones():
            boundary = _local_midnight(day if start else day + timedelta(days=1), tz_name)
            cond |= (
                Q(branch__timezone=tz_name, placed_at__gte=boundary)
                if start
                else Q(branch__timezone=tz_name, placed_at__lt=boundary)
            )
        return qs.filter(cond) if cond else qs.none()

    def filter_date_from(self, qs, name, value):
        return self._per_timezone(qs, value, start=True)

    def filter_date_to(self, qs, name, value):
        return self._per_timezone(qs, value, start=False)

    def filter_stuck(self, qs, name, value):
        cond = stuck_q()
        return qs.filter(cond) if value else qs.exclude(cond)
