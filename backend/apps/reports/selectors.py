"""Read-only report queries. Every figure is a SQL aggregate (Sum / Count / conditional aggregates / date_trunc in the
branch's time zone); nothing loads orders into Python. Python only merges already-aggregated rows (zero-fill, shares,
names) and does the final division for averages and percentages.

Definitions live in `definitions.py`; the counting rule is `sql.counted_q`.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable
from decimal import Decimal

from django.db.models import (
    BooleanField,
    Case,
    CharField,
    Count,
    Exists,
    ExpressionWrapper,
    F,
    IntegerField,
    Max,
    Min,
    OuterRef,
    Q,
    Sum,
    Value,
    When,
)
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.permissions import has_capability
from apps.catalog.models import Product
from apps.inventory.models import InventoryMovement, StockItem
from apps.orders.models import Order, OrderItem
from apps.payments.models import Payment, Refund
from apps.promotions.models import CouponRedemption

from .context import ReportContext, Window, bucket_expr, bucket_key, bucket_starts, local_date
from .definitions import PENDING_STATUSES, STUCK_AFTER_MINUTES
from .sql import MONEY, ZERO, collected_expr, counted_q, msum, net_expr

S = Order.Status
UNCATEGORISED = "Uncategorised"


# ---------------------------------------------------------------------------------------------------------------------
# small pure helpers (arithmetic on already-aggregated values)
# ---------------------------------------------------------------------------------------------------------------------
def money(value) -> Decimal:
    return (Decimal(value) if value is not None else ZERO).quantize(Decimal("0.01"))


def ratio(numerator, denominator) -> Decimal:
    """numerator / denominator quantised to cents (half-up); 0.00 when the denominator is zero."""
    from apps.core.money import q

    return q(Decimal(numerator) / Decimal(denominator)) if denominator else ZERO


def pct(part, whole) -> float:
    """part / whole as a percentage with one decimal; 0.0 when whole is zero."""
    return round(float(Decimal(part) * 100 / Decimal(whole)), 1) if whole else 0.0


def delta_pct(current, previous) -> float | None:
    """Percentage change vs the previous period; None when it is undefined (previous is zero / missing)."""
    if previous is None or Decimal(previous) == 0:
        return None
    return round(float((Decimal(current) - Decimal(previous)) * 100 / Decimal(previous)), 1)


def mask_name(full_name: str) -> str:
    """'Jane Doe' -> 'Jane D.'; single names are kept; empty -> 'Customer'."""
    parts = (full_name or "").split()
    if not parts:
        return "Customer"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0].upper()}."


def mask_email(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    if not domain:
        return ""
    return f"{local[:1]}***@{domain}"


def mask_phone(phone: str) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    return f"***{digits[-2:]}" if len(digits) >= 4 else ""


# ---------------------------------------------------------------------------------------------------------------------
# orders
# ---------------------------------------------------------------------------------------------------------------------
def _orders(ctx: ReportContext, window: Window):
    return Order.objects.filter(ctx.scope_q("branch_id"), window.q("placed_at", "branch"))


def order_totals(ctx: ReportContext, window: Window) -> dict:
    """The money and count figures behind every KPI, for one window, in a single aggregate query."""
    counted = counted_q()
    agg = _orders(ctx, window).aggregate(
        orders_total=Count("pk"),
        orders_counted=Count("pk", filter=counted),
        orders_completed=Count("pk", filter=Q(status=S.COMPLETED)),
        orders_cancelled=Count("pk", filter=Q(status=S.CANCELLED)),
        demo_orders=Count("pk", filter=counted & Q(is_demo=True)),
        gross_sales=msum("subtotal", counted),
        discounts=msum("discount_total", counted),
        delivery_fees=msum("delivery_fee", counted),
        tax=msum("tax_total", counted),
        refunds=msum("refunded_total", counted),
        net_sales=msum(net_expr(), counted),
        revenue_collected=msum(collected_expr(), counted),
        **{f"status__{s.value}": Count("pk", filter=Q(status=s)) for s in S},
    )
    agg["orders_pending"] = sum(agg[f"status__{s}"] for s in PENDING_STATUSES)
    agg["average_order_value"] = ratio(agg["net_sales"], agg["orders_counted"])
    return agg


def payment_failures(ctx: ReportContext, window: Window) -> int:
    return Payment.objects.filter(
        ctx.scope_q("order__branch_id"),
        window.q("created_at", "order__branch"),
        status=Payment.Status.FAILED,
    ).count()


def stock_snapshot(ctx: ReportContext) -> dict:
    """Right-now stock health for active stock-managed products in scope (distinct products)."""
    low = Q(quantity__gt=0, quantity__lte=F("low_stock_threshold"))
    return StockItem.objects.filter(
        ctx.scope_q("branch_id"), product__is_active=True, product__stock_mode=Product.StockMode.STOCKED
    ).aggregate(
        low_stock_products=Count("product_id", filter=low, distinct=True),
        out_of_stock_products=Count("product_id", filter=Q(quantity=0), distinct=True),
        low_or_out_products=Count("product_id", filter=Q(quantity__lte=F("low_stock_threshold")), distinct=True),
    )


MONEY_KPIS = (
    "gross_sales",
    "discounts",
    "delivery_fees",
    "tax",
    "refunds",
    "net_sales",
    "revenue_collected",
    "average_order_value",
)
COUNT_KPIS = (
    "orders_total",
    "orders_counted",
    "orders_completed",
    "orders_pending",
    "orders_cancelled",
    "payment_failures",
)
SNAPSHOT_KPIS = ("active_products", "low_stock_products", "out_of_stock_products")
KPI_ORDER = (
    "gross_sales",
    "discounts",
    "delivery_fees",
    "tax",
    "refunds",
    "net_sales",
    "revenue_collected",
    "orders_total",
    "orders_counted",
    "orders_completed",
    "orders_pending",
    "orders_cancelled",
    "average_order_value",
    "payment_failures",
    "active_products",
    "low_stock_products",
    "out_of_stock_products",
)


def kpis(ctx: ReportContext) -> tuple[dict, dict, dict]:
    """Returns (kpi dict with value/previous/delta_pct, current order totals, stock snapshot)."""
    cur = order_totals(ctx, ctx.window)
    prev = order_totals(ctx, ctx.previous_window)
    cur["payment_failures"] = payment_failures(ctx, ctx.window)
    prev["payment_failures"] = payment_failures(ctx, ctx.previous_window)
    stock = stock_snapshot(ctx)
    snapshot = {
        "active_products": Product.objects.filter(is_active=True).count(),
        "low_stock_products": stock["low_stock_products"],
        "out_of_stock_products": stock["out_of_stock_products"],
    }
    out: dict[str, dict] = {}
    for key in KPI_ORDER:
        if key in SNAPSHOT_KPIS:
            out[key] = {"value": snapshot[key], "previous": None, "delta_pct": None}
        else:
            out[key] = {"value": cur[key], "previous": prev[key], "delta_pct": delta_pct(cur[key], prev[key])}
    return out, cur, stock


def status_breakdown(totals: dict) -> list[dict]:
    total = totals["orders_total"]
    return [
        {
            "status": s.value,
            "label": s.label,
            "count": totals[f"status__{s.value}"],
            "share": pct(totals[f"status__{s.value}"], total),
        }
        for s in S
    ]


# ---------------------------------------------------------------------------------------------------------------------
# sales series
# ---------------------------------------------------------------------------------------------------------------------
def sales_series(ctx: ReportContext) -> list[dict]:
    """One row per bucket in the range, zero-filled. Buckets are branch-local days / ISO weeks / months."""
    rows = (
        _orders(ctx, ctx.window)
        .filter(counted_q())
        .annotate(bucket=bucket_expr(ctx.granularity, "placed_at", "branch", ctx.tz_names))
        .values("bucket")
        .annotate(
            orders=Count("pk"),
            gross_sales=msum("subtotal"),
            discounts=msum("discount_total"),
            delivery_fees=msum("delivery_fee"),
            tax=msum("tax_total"),
            refunds=msum("refunded_total"),
            net_sales=msum(net_expr()),
            revenue_collected=msum(collected_expr()),
        )
        .order_by("bucket")
    )
    by_bucket = {bucket_key(ctx, r["bucket"]): r for r in rows}
    zero = {
        "orders": 0,
        "gross_sales": ZERO,
        "discounts": ZERO,
        "delivery_fees": ZERO,
        "tax": ZERO,
        "refunds": ZERO,
        "net_sales": ZERO,
        "revenue_collected": ZERO,
    }
    out = []
    for start in bucket_starts(ctx):
        row = by_bucket.get(start)
        data = {k: (row[k] if row else v) for k, v in zero.items()}
        data["average_order_value"] = ratio(data["net_sales"], data["orders"])
        data["bucket"] = start
        out.append(data)
    return out


def sales_totals(rows: Iterable[dict]) -> dict:
    rows = list(rows)
    t = {
        k: sum((r[k] for r in rows), ZERO)
        for k in ("gross_sales", "discounts", "delivery_fees", "tax", "refunds", "net_sales", "revenue_collected")
    }
    t["orders"] = sum(r["orders"] for r in rows)
    t["average_order_value"] = ratio(t["net_sales"], t["orders"])
    return t


# ---------------------------------------------------------------------------------------------------------------------
# items: products and categories
# ---------------------------------------------------------------------------------------------------------------------
def _items(ctx: ReportContext):
    return OrderItem.objects.filter(
        counted_q("order__"),
        ctx.scope_q("order__branch_id"),
        ctx.window.q("order__placed_at", "order__branch"),
    )


def _item_totals(ctx: ReportContext) -> dict:
    t = _items(ctx).aggregate(
        units=Sum("quantity"),
        orders=Count("order_id", distinct=True),
        gross=msum("line_total"),
        discounts=msum("discount_amount"),
        net=msum(F("line_total") - F("discount_amount")),
    )
    t["units"] = t["units"] or 0
    return t


def _with_share(rows: list[dict], total_net) -> list[dict]:
    for r in rows:
        r["share"] = pct(r["net"], total_net)
    return rows


PRODUCT_SORTS = {
    "units": lambda r: r["units"],
    "gross": lambda r: r["gross"],
    "net": lambda r: r["net"],
    "orders": lambda r: r["orders"],
    "name": lambda r: r["product_name"].lower(),
}


def product_rows(ctx: ReportContext, ordering: str = "-net") -> tuple[list[dict], dict]:
    rows = list(
        _items(ctx)
        .values("sku")
        .annotate(
            product_name=Max("product_name"),
            category_name=Max("category_name"),
            units=Sum("quantity"),
            orders=Count("order_id", distinct=True),
            gross=msum("line_total"),
            discounts=msum("discount_amount"),
            net=msum(F("line_total") - F("discount_amount")),
        )
        .order_by("sku")
    )
    totals = _item_totals(ctx)
    _with_share(rows, totals["net"])
    descending = ordering.startswith("-")
    key = PRODUCT_SORTS[ordering.lstrip("-")]
    rows.sort(key=lambda r: (key(r), r["sku"]), reverse=descending)
    return rows, totals


def top_products(ctx: ReportContext, limit: int = 10) -> dict:
    """Top `limit` products by units and by revenue (net of item discounts), from order-item snapshots.

    One grouped query (bounded by the catalogue size); ranking happens on those few already-aggregated rows."""
    rows = list(
        _items(ctx)
        .values("sku")
        .annotate(
            product_name=Max("product_name"),
            units=Sum("quantity"),
            revenue=msum(F("line_total") - F("discount_amount")),
        )
    )
    return {
        "by_units": sorted(rows, key=lambda r: (-r["units"], -r["revenue"], r["sku"]))[:limit],
        "by_revenue": sorted(rows, key=lambda r: (-r["revenue"], -r["units"], r["sku"]))[:limit],
    }


def category_rows(ctx: ReportContext, *, with_totals: bool = True) -> tuple[list[dict], dict | None]:
    """Category sales. `with_totals=False` skips the extra distinct-order-count query (the dashboard does not need it)."""
    rows = list(
        _items(ctx)
        .values("category_name")
        .annotate(
            units=Sum("quantity"),
            orders=Count("order_id", distinct=True),
            gross=msum("line_total"),
            discounts=msum("discount_amount"),
            net=msum(F("line_total") - F("discount_amount")),
        )
        .order_by("-net", "category_name")
    )
    for r in rows:
        r["category"] = r.pop("category_name") or UNCATEGORISED
    totals = _item_totals(ctx) if with_totals else None
    _with_share(rows, totals["net"] if totals else sum((r["net"] for r in rows), ZERO))
    return rows, totals


# ---------------------------------------------------------------------------------------------------------------------
# branches
# ---------------------------------------------------------------------------------------------------------------------
def branch_rows(ctx: ReportContext) -> tuple[list[dict], dict]:
    counted = counted_q()
    agg = {
        r["branch_id"]: r
        for r in _orders(ctx, ctx.window)
        .values("branch_id")
        .annotate(
            orders_total=Count("pk"),
            orders=Count("pk", filter=counted),
            gross_sales=msum("subtotal", counted),
            discounts=msum("discount_total", counted),
            refunds=msum("refunded_total", counted),
            net_sales=msum(net_expr(), counted),
            revenue_collected=msum(collected_expr(), counted),
        )
    }
    rows = []
    for b in ctx.branches:
        r = agg.get(b.id)
        row = {
            "branch_id": b.id,
            "branch": b.name,
            "timezone": b.timezone,
            "orders_total": r["orders_total"] if r else 0,
            "orders": r["orders"] if r else 0,
            "gross_sales": r["gross_sales"] if r else ZERO,
            "discounts": r["discounts"] if r else ZERO,
            "refunds": r["refunds"] if r else ZERO,
            "net_sales": r["net_sales"] if r else ZERO,
            "revenue_collected": r["revenue_collected"] if r else ZERO,
        }
        row["average_order_value"] = ratio(row["net_sales"], row["orders"])
        rows.append(row)
    rows.sort(key=lambda r: (-r["net_sales"], r["branch"]))
    totals = {
        "orders_total": sum(r["orders_total"] for r in rows),
        "orders": sum(r["orders"] for r in rows),
    }
    for k in ("gross_sales", "discounts", "refunds", "net_sales", "revenue_collected"):
        totals[k] = sum((r[k] for r in rows), ZERO)
    totals["average_order_value"] = ratio(totals["net_sales"], totals["orders"])
    return rows, totals


# ---------------------------------------------------------------------------------------------------------------------
# promotions
# ---------------------------------------------------------------------------------------------------------------------
def promotion_rows(ctx: ReportContext) -> tuple[list[dict], dict]:
    redemptions = (
        CouponRedemption.objects.filter(
            ctx.scope_q("order__branch_id"),
            ctx.window.q("order__placed_at", "order__branch"),
            is_voided=False,
        )
        .values(
            "coupon_id",
            "coupon__code",
            "coupon__name",
            "coupon__discount_type",
            "coupon__value",
            "coupon__is_automatic",
            "coupon__is_active",
        )
        .annotate(redemptions=Count("pk"), discount_given=msum("discount_amount"))
    )
    counted = counted_q()
    orders = {
        r["coupon_id"]: r
        for r in _orders(ctx, ctx.window)
        .filter(counted, coupon__isnull=False)
        .values("coupon_id")
        .annotate(orders=Count("pk"), revenue_influenced=msum(collected_expr()))
    }
    rows = []
    for r in redemptions:
        o = orders.get(r["coupon_id"])
        rows.append(
            {
                "coupon_id": r["coupon_id"],
                "code": r["coupon__code"],
                "name": r["coupon__name"],
                "discount_type": r["coupon__discount_type"],
                "value": r["coupon__value"],
                "is_automatic": r["coupon__is_automatic"],
                "is_active": r["coupon__is_active"],
                "redemptions": r["redemptions"],
                "discount_given": r["discount_given"],
                "orders": o["orders"] if o else 0,
                "revenue_influenced": o["revenue_influenced"] if o else ZERO,
            }
        )
    # coupons used by counted orders whose redemption row is voided/missing still deserve a line
    seen = {r["coupon_id"] for r in rows}
    missing = [cid for cid in orders if cid not in seen]
    if missing:
        from apps.promotions.models import Coupon

        for c in Coupon.objects.filter(pk__in=missing).values(
            "pk", "code", "name", "discount_type", "value", "is_automatic", "is_active"
        ):
            o = orders[c["pk"]]
            rows.append(
                {
                    "coupon_id": c["pk"],
                    "code": c["code"],
                    "name": c["name"],
                    "discount_type": c["discount_type"],
                    "value": c["value"],
                    "is_automatic": c["is_automatic"],
                    "is_active": c["is_active"],
                    "redemptions": 0,
                    "discount_given": ZERO,
                    "orders": o["orders"],
                    "revenue_influenced": o["revenue_influenced"],
                }
            )
    rows.sort(key=lambda r: (-r["discount_given"], r["code"]))
    all_totals = order_totals(ctx, ctx.window)
    totals = {
        "redemptions": sum(r["redemptions"] for r in rows),
        "discount_given": sum((r["discount_given"] for r in rows), ZERO),
        "orders": sum(r["orders"] for r in rows),
        "revenue_influenced": sum((r["revenue_influenced"] for r in rows), ZERO),
        "discounts": all_totals["discounts"],  # every discount on counted orders (= dashboard KPI)
        "orders_counted": all_totals["orders_counted"],
    }
    return rows, totals


# ---------------------------------------------------------------------------------------------------------------------
# payments
# ---------------------------------------------------------------------------------------------------------------------
SETTLED_PAYMENT = (Payment.Status.PAID, Payment.Status.PARTIALLY_REFUNDED, Payment.Status.REFUNDED)


def _payments(ctx: ReportContext):
    return Payment.objects.filter(ctx.scope_q("order__branch_id"), ctx.window.q("created_at", "order__branch"))


def payment_report(ctx: ReportContext) -> tuple[list[dict], dict, list[dict]]:
    rows = list(
        _payments(ctx)
        .values("provider", "status", "is_sandbox")
        .annotate(count=Count("pk"), sum_amount=msum("amount"), sum_refunded=msum("refunded_total"))
        .order_by("provider", "status", "is_sandbox")
    )
    rows = [{**r, "amount": r["sum_amount"], "refunded": r["sum_refunded"]} for r in rows]
    settled = Q(status__in=SETTLED_PAYMENT)
    t = _payments(ctx).aggregate(
        payments=Count("pk"),
        total_amount=msum("amount"),
        settled_payments=Count("pk", filter=settled),
        settled_amount=msum("amount", settled),
        refunded_amount=msum("refunded_total"),
        payment_failures=Count("pk", filter=Q(status=Payment.Status.FAILED)),
        failed_amount=msum("amount", Q(status=Payment.Status.FAILED)),
        sandbox_payments=Count("pk", filter=Q(is_sandbox=True)),
    )
    t["amount"] = t.pop("total_amount")
    t["collected_amount"] = t["settled_amount"] - t["refunded_amount"]
    t["failure_rate"] = pct(t["payment_failures"], t["payments"])
    t["includes_sandbox"] = t["sandbox_payments"] > 0
    failures = list(
        _payments(ctx)
        .filter(status=Payment.Status.FAILED)
        .values("provider", "failure_code")
        .annotate(count=Count("pk"), sum_amount=msum("amount"))
        .order_by("-count", "provider", "failure_code")[:10]
    )
    failures = [{**f, "amount": f["sum_amount"]} for f in failures]
    return rows, t, failures


# ---------------------------------------------------------------------------------------------------------------------
# refunds and cancellations
# ---------------------------------------------------------------------------------------------------------------------
REFUND_NEEDED = Q(
    status=S.CANCELLED, payment_status__in=(Order.PaymentStatus.PAID, Order.PaymentStatus.PARTIALLY_REFUNDED)
) & Q(refunded_total__lt=F("total"))


def refund_needed_orders(ctx: ReportContext):
    """Cancelled orders that were paid and are not yet fully refunded (all time, in scope)."""
    return Order.objects.filter(ctx.scope_q("branch_id")).filter(REFUND_NEEDED)


def refund_rows_queryset(ctx: ReportContext):
    return (
        Refund.objects.filter(
            ctx.scope_q("payment__order__branch_id"),
            ctx.window.q("payment__order__placed_at", "payment__order__branch"),
        )
        .annotate(
            order_number=F("payment__order__number"),
            order_status=F("payment__order__status"),
            provider=F("payment__provider"),
            is_sandbox=F("payment__is_sandbox"),
            counted_in_sales=ExpressionWrapper(counted_q("payment__order__"), output_field=BooleanField()),
        )
        .values(
            "id",
            "order_number",
            "order_status",
            "provider",
            "is_sandbox",
            "amount",
            "status",
            "reason",
            "failure_message",
            "counted_in_sales",
            "created_at",
        )
        .order_by("-created_at", "-id")
    )


def refund_report(ctx: ReportContext) -> tuple[dict, list[dict]]:
    base = Refund.objects.filter(
        ctx.scope_q("payment__order__branch_id"),
        ctx.window.q("payment__order__placed_at", "payment__order__branch"),
    )
    r = base.aggregate(
        refund_rows=Count("pk"),
        refunded_amount=msum("amount", Q(status=Refund.Status.SUCCEEDED)),
        pending_amount=msum("amount", Q(status=Refund.Status.PENDING)),
        failed_refunds=Count("pk", filter=Q(status=Refund.Status.FAILED)),
    )
    kpi = order_totals(ctx, ctx.window)
    cancelled = _orders(ctx, ctx.window).filter(status=S.CANCELLED)
    c = cancelled.aggregate(
        cancelled_orders=Count("pk"),
        cancelled_value=msum("total"),
        cancelled_paid_unrefunded=Count("pk", filter=REFUND_NEEDED),
        cancelled_unrefunded_amount=msum(F("total") - F("refunded_total"), REFUND_NEEDED),
    )
    totals = {
        "refunds": kpi["refunds"],  # same figure as the dashboard KPI (refunds on counted orders)
        **r,
        **c,
        "refund_needed_orders": refund_needed_orders(ctx).count(),
    }
    cancellations = list(
        cancelled.annotate(
            refund_needed=ExpressionWrapper(REFUND_NEEDED, output_field=BooleanField()),
            amount_to_refund=Case(
                When(REFUND_NEEDED, then=F("total") - F("refunded_total")),
                default=Value(ZERO),
                output_field=MONEY,
            ),
        )
        .values(
            "number",
            "cancelled_at",
            "cancel_reason",
            "payment_status",
            "total",
            "refunded_total",
            "refund_needed",
            "amount_to_refund",
            "placed_at",
        )
        .order_by("-cancelled_at", "-placed_at", "-id")[:100]
    )
    return totals, cancellations


# ---------------------------------------------------------------------------------------------------------------------
# inventory
# ---------------------------------------------------------------------------------------------------------------------
INVENTORY_SORTS = {
    "product": "product_name",
    "quantity": "quantity",
    "value": "value",
    "branch": "branch_name",
    "status": "severity",
}


def _stock(ctx: ReportContext):
    return StockItem.objects.filter(ctx.scope_q("branch_id"))


def stock_rows_queryset(ctx: ReportContext, ordering: str = "status", status: str | None = None):
    low = Q(quantity__gt=0, quantity__lte=F("low_stock_threshold"))
    qs = (
        _stock(ctx)
        .annotate(
            severity=Case(
                When(quantity=0, then=Value(0)),
                When(low, then=Value(1)),
                default=Value(2),
                output_field=IntegerField(),
            ),
            status=Case(
                When(quantity=0, then=Value("out")),
                When(low, then=Value("low")),
                default=Value("ok"),
                output_field=CharField(),
            ),
            value=Case(
                When(unit_cost__isnull=False, then=F("quantity") * F("unit_cost")),
                default=Value(None),
                output_field=MONEY,
            ),
            branch_name=F("branch__name"),
            product_name=F("product__name"),
            sku=F("product__sku"),
            category_name=F("product__category__name"),
            is_active=F("product__is_active"),
        )
        .values(
            "id",
            "branch_id",
            "branch_name",
            "product_id",
            "product_name",
            "sku",
            "category_name",
            "is_active",
            "quantity",
            "low_stock_threshold",
            "unit_cost",
            "value",
            "status",
        )
    )
    if status:
        qs = qs.filter(status=status)
    descending = ordering.startswith("-")
    field = INVENTORY_SORTS[ordering.lstrip("-")]
    secondary = ["product_name", "branch_name", "id"]
    return qs.order_by(F(field).desc(nulls_last=True) if descending else F(field).asc(nulls_last=True), *secondary)


def inventory_report(ctx: ReportContext) -> tuple[dict, list[dict], list[dict]]:
    low = Q(quantity__gt=0, quantity__lte=F("low_stock_threshold"))
    out = Q(quantity=0)
    totals = _stock(ctx).aggregate(
        stock_items=Count("pk"),
        units_on_hand=Sum("quantity"),
        stock_value=msum(F("quantity") * F("unit_cost")),
        items_without_cost=Count("pk", filter=Q(unit_cost__isnull=True)),
        low_stock_items=Count("pk", filter=low),
        out_of_stock_items=Count("pk", filter=out),
    )
    totals["units_on_hand"] = totals["units_on_hand"] or 0
    snap = stock_snapshot(ctx)
    totals["low_stock_products"] = snap["low_stock_products"]
    totals["out_of_stock_products"] = snap["out_of_stock_products"]

    low_list = list(stock_rows_queryset(ctx, "status").filter(status__in=("out", "low"), is_active=True)[:50])
    movement_rows = {
        r["movement_type"]: r
        for r in InventoryMovement.objects.filter(
            ctx.scope_q("stock_item__branch_id"), ctx.window.q("created_at", "stock_item__branch")
        )
        .values("movement_type")
        .annotate(
            movements=Count("pk"),
            units_in=Sum("quantity_delta", filter=Q(quantity_delta__gt=0)),
            units_out=Sum(-F("quantity_delta"), filter=Q(quantity_delta__lt=0)),
        )
    }
    movements = []
    for t in InventoryMovement.Type:
        r = movement_rows.get(t.value)
        units_in = (r["units_in"] or 0) if r else 0
        units_out = (r["units_out"] or 0) if r else 0
        movements.append(
            {
                "movement_type": t.value,
                "label": t.label,
                "movements": r["movements"] if r else 0,
                "units_in": units_in,
                "units_out": units_out,
                "net_units": units_in - units_out,
            }
        )
    return totals, low_list, movements


# ---------------------------------------------------------------------------------------------------------------------
# customers
# ---------------------------------------------------------------------------------------------------------------------
def customer_report(ctx: ReportContext, top_n: int = 20) -> tuple[dict, list[dict], list[dict], list[dict]]:
    counted = counted_q()
    window = ctx.window
    in_window = _orders(ctx, window).filter(counted)

    per_customer = in_window.values("customer_id").annotate(n=Count("pk"))
    freq = per_customer.aggregate(
        customers=Count("customer_id"),
        one=Count("customer_id", filter=Q(n=1)),
        two_three=Count("customer_id", filter=Q(n__gte=2, n__lte=3)),
        four_plus=Count("customer_id", filter=Q(n__gte=4)),
    )
    buckets = [
        {"bucket": "1", "label": "1 order", "customers": freq["one"]},
        {"bucket": "2-3", "label": "2-3 orders", "customers": freq["two_three"]},
        {"bucket": "4+", "label": "4+ orders", "customers": freq["four_plus"]},
    ]
    for b in buckets:
        b["share"] = pct(b["customers"], freq["customers"])

    # new vs returning: first counted order (branch-local day, all time, same branch scope) falls inside the window?
    first_day = Min(local_date("placed_at", "branch", ctx.tz_names))
    history = (
        Order.objects.filter(ctx.scope_q("branch_id"), counted, placed_at__lt=_end_bound(ctx))
        .values("customer_id")
        .annotate(in_window=Count("pk", filter=window.q("placed_at", "branch")), first_day=first_day)
        .filter(in_window__gt=0)
    )
    nr = history.aggregate(
        new_customers=Count("customer_id", filter=Q(first_day__gte=ctx.date_from)),
        returning_customers=Count("customer_id", filter=Q(first_day__lt=ctx.date_from)),
    )

    totals = (
        _orders(ctx, window)
        .filter(counted)
        .aggregate(orders=Count("pk"), revenue_collected=msum(collected_expr()), net_sales=msum(net_expr()))
    )
    totals.update(
        customers=freq["customers"],
        new_customers=nr["new_customers"],
        returning_customers=nr["returning_customers"],
    )
    totals["orders_per_customer"] = round(totals["orders"] / totals["customers"], 2) if totals["customers"] else 0.0

    top = list(
        in_window.values(
            "customer_id", "customer__first_name", "customer__last_name", "customer__email", "customer__phone"
        )
        .annotate(orders=Count("pk"), spend=msum(collected_expr()), last_order_at=Max("placed_at"))
        .order_by("-spend", "-orders", "customer_id")[:top_n]
    )
    top_customers = [
        {
            "customer_id": r["customer_id"],
            "name": mask_name(f"{r['customer__first_name']} {r['customer__last_name']}"),
            "email": mask_email(r["customer__email"]),
            "phone": mask_phone(r["customer__phone"]),
            "orders": r["orders"],
            "spend": r["spend"],
            "last_order_at": r["last_order_at"],
        }
        for r in top
    ]
    new_vs_returning = [
        {
            "segment": "new",
            "label": "New customers",
            "customers": nr["new_customers"],
            "share": pct(nr["new_customers"], freq["customers"]),
        },
        {
            "segment": "returning",
            "label": "Returning customers",
            "customers": nr["returning_customers"],
            "share": pct(nr["returning_customers"], freq["customers"]),
        },
    ]
    return totals, buckets, new_vs_returning, top_customers


def _end_bound(ctx: ReportContext) -> dt.datetime:
    """Conservative UTC instant after the window's last local day (covers every zone)."""
    return dt.datetime.combine(ctx.date_to + dt.timedelta(days=2), dt.time.min, tzinfo=dt.UTC)


# ---------------------------------------------------------------------------------------------------------------------
# dashboard
# ---------------------------------------------------------------------------------------------------------------------
def attention_counts(ctx: ReportContext, stock: dict) -> dict:
    now = timezone.now()
    cutoff = now - dt.timedelta(minutes=STUCK_AFTER_MINUTES)
    open_orders = Q(status__in=PENDING_STATUSES)
    awaiting_customer_payment = (
        Q(status=S.PENDING)
        & ~Q(payment_method="cash")
        & Q(
            payment_status__in=(
                Order.PaymentStatus.PENDING,
                Order.PaymentStatus.REQUIRES_ACTION,
                Order.PaymentStatus.FAILED,
            )
        )
    )
    scheduled_later = Q(requested_for__gt=now)
    scoped = Order.objects.filter(ctx.scope_q("branch_id"))
    agg = scoped.aggregate(
        stuck_orders=Count(
            "pk", filter=open_orders & Q(updated_at__lt=cutoff) & ~awaiting_customer_payment & ~scheduled_later
        ),
        failed_payments=Count(
            "pk", filter=Q(payment_status=Order.PaymentStatus.FAILED) & ~Q(status__in=(S.COMPLETED, S.CANCELLED))
        ),
        refund_needed=Count("pk", filter=REFUND_NEEDED),
    )
    agg["low_stock"] = stock["low_or_out_products"]
    return agg


def recent_orders(ctx: ReportContext, limit: int = 8) -> list[dict]:
    rows = (
        Order.objects.filter(ctx.scope_q("branch_id"))
        .order_by("-placed_at", "-id")
        .values("number", "customer_name", "total", "status", "payment_status", "placed_at", "branch__name")[:limit]
    )
    return [
        {
            "number": r["number"],
            "customer": mask_name(r["customer_name"]),
            "branch": r["branch__name"],
            "total": r["total"],
            "status": r["status"],
            "payment_status": r["payment_status"],
            "placed_at": r["placed_at"],
        }
        for r in rows
    ]


def recent_customers(ctx: ReportContext, limit: int = 5) -> list[dict]:
    """Last sign-ups (no email/phone). Staff without customers.view get none; branch-scoped staff only see customers
    who have ordered at their branches."""
    if not has_capability(ctx.user, "customers.view"):
        return []
    qs = User.objects.filter(is_staff=False, is_active=True, staff_profile__isnull=True)
    if ctx.branch_ids is not None:
        qs = qs.filter(Exists(Order.objects.filter(customer_id=OuterRef("pk"), branch_id__in=sorted(ctx.branch_ids))))
    return [
        {"name": mask_name(f"{u['first_name']} {u['last_name']}"), "joined_at": u["date_joined"]}
        for u in qs.order_by("-date_joined", "-id").values("first_name", "last_name", "date_joined")[:limit]
    ]


def dashboard(ctx: ReportContext) -> dict:
    kpi, cur, stock = kpis(ctx)
    categories, _ = category_rows(ctx, with_totals=False)
    branches, _ = branch_rows(ctx)
    return {
        "period": ctx.period(),
        "kpis": kpi,
        "series": sales_series(ctx),
        "orders_by_status": status_breakdown(cur),
        "category_sales": categories[:10],
        "top_products": top_products(ctx),
        "branch_performance": branches,
        "recent_orders": recent_orders(ctx),
        "recent_customers": recent_customers(ctx),
        "attention": attention_counts(ctx, stock),
        "generated_at": timezone.now(),
        "is_demo_data": cur["demo_orders"] > 0,
    }
