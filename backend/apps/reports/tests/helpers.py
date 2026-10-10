"""Deterministic dataset builders for report tests (plain ORM, honouring every model constraint) and a small
independent Python oracle that recomputes the expected figures without any SQL aggregation."""

from __future__ import annotations

import datetime as dt
import itertools
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from apps.inventory.models import InventoryMovement, StockItem
from apps.orders.models import Order, OrderItem
from apps.payments.models import Payment, Refund
from apps.promotions.models import Coupon, CouponRedemption

_seq = itertools.count(1)
D = Decimal
ZERO = D("0.00")
PAID_STATES = {"PAID", "PARTIALLY_REFUNDED", "REFUNDED"}


def utc(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=dt.UTC)


@dataclass
class Line:
    """(sku, name, category, unit_price, qty, discount) of an order item."""

    sku: str
    name: str
    category: str
    unit_price: Decimal
    qty: int = 1
    discount: Decimal = ZERO

    @property
    def total(self) -> Decimal:
        return self.unit_price * self.qty


COFFEE = lambda qty=1, discount=ZERO: Line("COF-1", "House Espresso", "Coffee", D("3.50"), qty, D(discount))  # noqa: E731
BEANS = lambda qty=1, discount=ZERO: Line("BEA-1", "Ethiopia Beans 250g", "Beans", D("14.00"), qty, D(discount))  # noqa: E731
CAKE = lambda qty=1, discount=ZERO: Line("CAK-1", "Lemon Cake", "Food", D("4.25"), qty, D(discount))  # noqa: E731


@dataclass
class Spec:
    """What was created, as plain Python (the oracle's input)."""

    order: Order
    branch_tz: str
    lines: list[Line]
    status: str
    payment_status: str
    payment_method: str
    placed_at: dt.datetime
    discount: Decimal
    delivery_fee: Decimal
    tax: Decimal
    refunded: Decimal
    total: Decimal
    subtotal: Decimal
    is_demo: bool
    customer_id: int
    branch_id: int
    coupon_id: int | None = None

    @property
    def local_date(self) -> dt.date:
        return self.placed_at.astimezone(ZoneInfo(self.branch_tz)).date()

    @property
    def counted(self) -> bool:
        if self.status == "CANCELLED":
            return False
        return self.payment_status in PAID_STATES or (self.payment_method == "cash" and self.status == "COMPLETED")


def make_order(
    branch,
    customer,
    placed_at: dt.datetime,
    lines: list[Line] | None = None,
    *,
    status: str = "COMPLETED",
    payment_status: str = "PAID",
    payment_method: str = "demo",
    delivery_fee="0.00",
    tax="0.00",
    refunded="0.00",
    coupon: Coupon | None = None,
    is_demo: bool = False,
    order_type: str = "PICKUP",
    updated_at: dt.datetime | None = None,
    requested_for: dt.datetime | None = None,
    payment: bool | str = True,
    customer_name: str | None = None,
) -> Spec:
    """Create an order whose totals are consistent: subtotal = sum(lines), discount = sum(item discounts)."""
    lines = lines or [COFFEE()]
    n = next(_seq)
    subtotal = sum((ln.total for ln in lines), ZERO)
    discount = sum((ln.discount for ln in lines), ZERO)
    delivery_fee, tax, refunded = D(delivery_fee), D(tax), D(refunded)
    total = subtotal - discount + delivery_fee + tax
    order = Order.objects.create(
        number=f"T-{n:06d}",
        customer=customer,
        branch=branch,
        order_type=order_type,
        status=status,
        payment_status=payment_status,
        payment_method=payment_method,
        currency="USD",
        subtotal=subtotal,
        discount_total=discount,
        delivery_fee=delivery_fee,
        tax_total=tax,
        total=total,
        refunded_total=refunded,
        coupon=coupon,
        coupon_code=coupon.code if coupon else "",
        customer_name=customer_name or f"{customer.first_name} {customer.last_name}".strip(),
        customer_email=customer.email,
        customer_phone=customer.phone,
        delivery_address={"line1": "1 Road"} if order_type == "DELIVERY" else None,
        idempotency_key=f"idem-{n}",
        is_demo=is_demo,
        placed_at=placed_at,
        requested_for=requested_for,
        cancelled_at=placed_at if status == "CANCELLED" else None,
        cancel_reason="Customer changed mind" if status == "CANCELLED" else "",
    )
    for ln in lines:
        OrderItem.objects.create(
            order=order,
            product_name=ln.name,
            sku=ln.sku,
            category_name=ln.category,
            base_price=ln.unit_price,
            unit_price=ln.unit_price,
            quantity=ln.qty,
            line_total=ln.total,
            discount_amount=ln.discount,
        )
    if updated_at is not None:  # auto_now on save: bypass with update()
        Order.objects.filter(pk=order.pk).update(updated_at=updated_at)
    if payment:
        pay_status = payment if isinstance(payment, str) else payment_status
        if (
            pay_status
            in (
                "PENDING",
                "REQUIRES_ACTION",
                "AUTHORIZED",
                "PAID",
                "FAILED",
                "CANCELLED",
                "PARTIALLY_REFUNDED",
                "REFUNDED",
            )
            and total > 0
        ):
            make_payment(order, status=pay_status, provider=payment_method, created_at=placed_at, refunded=refunded)
    if coupon is not None:
        CouponRedemption.objects.create(
            coupon=coupon,
            user=customer,
            order=order,
            discount_amount=discount,
            is_voided=status == "CANCELLED",
        )
    return Spec(
        order=order,
        branch_tz=branch.timezone,
        lines=lines,
        status=status,
        payment_status=payment_status,
        payment_method=payment_method,
        placed_at=placed_at,
        discount=discount,
        delivery_fee=delivery_fee,
        tax=tax,
        refunded=refunded,
        total=total,
        subtotal=subtotal,
        is_demo=is_demo,
        customer_id=customer.pk,
        branch_id=branch.pk,
        coupon_id=coupon.pk if coupon else None,
    )


def make_payment(
    order, *, status="PAID", provider="demo", created_at=None, refunded="0.00", failure_code="", sandbox=None
) -> Payment:
    n = next(_seq)
    payment = Payment.objects.create(
        order=order,
        provider=provider,
        status=status,
        amount=order.total or D("1.00"),
        currency="USD",
        reference=f"ref-{n}",
        idempotency_key=f"pay-{n}",
        is_sandbox=provider == "demo" if sandbox is None else sandbox,
        failure_code=failure_code,
        failure_message="Card declined" if status == "FAILED" else "",
        refunded_total=D(refunded),
    )
    if created_at is not None:  # auto_now_add
        Payment.objects.filter(pk=payment.pk).update(created_at=created_at)
        payment.refresh_from_db()
    return payment


def make_refund(
    payment: Payment, amount, *, status="SUCCEEDED", created_at=None, reason="Requested by customer"
) -> Refund:
    n = next(_seq)
    refund = Refund.objects.create(
        payment=payment,
        amount=D(amount),
        status=status,
        reason=reason,
        reference=f"rf-{n}",
        idempotency_key=f"refund-{n}",
    )
    if created_at is not None:
        Refund.objects.filter(pk=refund.pk).update(created_at=created_at)
    return refund


def make_coupon(code="SAVE10", **kw) -> Coupon:
    kw.setdefault("name", f"{code} promo")
    kw.setdefault("discount_type", "PERCENT")
    kw.setdefault("value", D("10"))
    return Coupon.objects.create(code=code, **kw)


def make_movement(stock: StockItem, kind: str, delta: int, created_at: dt.datetime | None = None) -> InventoryMovement:
    m = InventoryMovement.objects.create(
        stock_item=stock, movement_type=kind, quantity_delta=delta, quantity_after=max(stock.quantity, 0), reference="T"
    )
    if created_at is not None:
        InventoryMovement.objects.filter(pk=m.pk).update(created_at=created_at)
    return m


# ---------------------------------------------------------------------------------------------------------------------
# oracle: independent expected values from the Python-side specs
# ---------------------------------------------------------------------------------------------------------------------
def q2(value) -> Decimal:
    return D(value).quantize(D("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class Expected:
    specs: list[Spec] = field(default_factory=list)

    def window(self, d_from: dt.date, d_to: dt.date, branch_ids=None) -> list[Spec]:
        return [
            s
            for s in self.specs
            if d_from <= s.local_date <= d_to and (branch_ids is None or s.branch_id in branch_ids)
        ]

    def kpis(self, d_from, d_to, branch_ids=None) -> dict:
        rows = self.window(d_from, d_to, branch_ids)
        counted = [s for s in rows if s.counted]
        gross = sum((s.subtotal for s in counted), ZERO)
        disc = sum((s.discount for s in counted), ZERO)
        refunds = sum((s.refunded for s in counted), ZERO)
        net = gross - disc - refunds
        pending = {"PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"}
        return {
            "gross_sales": gross,
            "discounts": disc,
            "delivery_fees": sum((s.delivery_fee for s in counted), ZERO),
            "tax": sum((s.tax for s in counted), ZERO),
            "refunds": refunds,
            "net_sales": net,
            "revenue_collected": sum((s.total - s.refunded for s in counted), ZERO),
            "orders_total": len(rows),
            "orders_counted": len(counted),
            "orders_completed": sum(1 for s in rows if s.status == "COMPLETED"),
            "orders_pending": sum(1 for s in rows if s.status in pending),
            "orders_cancelled": sum(1 for s in rows if s.status == "CANCELLED"),
            "average_order_value": q2(net / len(counted)) if counted else ZERO,
        }

    def by_status(self, d_from, d_to, branch_ids=None) -> dict[str, int]:
        out: dict[str, int] = {}
        for s in self.window(d_from, d_to, branch_ids):
            out[s.status] = out.get(s.status, 0) + 1
        return out
