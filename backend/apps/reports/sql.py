"""SQL building blocks shared by every report: the counting rule and null-safe money aggregates."""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Count, DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce

from apps.orders.models import Order

ZERO = Decimal("0.00")
MONEY = DecimalField(max_digits=14, decimal_places=2)

PAID_STATES = (
    Order.PaymentStatus.PAID,
    Order.PaymentStatus.PARTIALLY_REFUNDED,
    Order.PaymentStatus.REFUNDED,
)


def counted_q(prefix: str = "") -> Q:
    """The counting rule (docs/implementation-plan.md §5): not CANCELLED and (paid/refunded or cash+COMPLETED)."""
    return ~Q(**{f"{prefix}status": Order.Status.CANCELLED}) & (
        Q(**{f"{prefix}payment_status__in": PAID_STATES})
        | Q(**{f"{prefix}payment_method": "cash", f"{prefix}status": Order.Status.COMPLETED})
    )


def msum(expression, filter: Q | None = None):  # noqa: A002 - mirrors Django's aggregate kwarg
    """Sum that is 0.00 (not NULL) over zero rows."""
    return Coalesce(Sum(expression, filter=filter, output_field=MONEY), Value(ZERO), output_field=MONEY)


def count_if(filter: Q | None = None, field: str = "pk", distinct: bool = False):  # noqa: A002
    return Count(field, filter=filter, distinct=distinct)


def net_expr(prefix: str = ""):
    """Per-order net sales: items - discounts - refunds."""
    return F(f"{prefix}subtotal") - F(f"{prefix}discount_total") - F(f"{prefix}refunded_total")


def collected_expr(prefix: str = ""):
    return F(f"{prefix}total") - F(f"{prefix}refunded_total")
