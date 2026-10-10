"""Response serializers. They exist for two reasons: formatting (money as 2dp strings) and an accurate OpenAPI schema,
from which the SPA's TypeScript types are generated. Selectors return plain dicts; views pass them through these."""

from __future__ import annotations

from rest_framework import serializers

from .context import GRANULARITIES, ReportQuerySerializer
from .selectors import INVENTORY_SORTS, KPI_ORDER, MONEY_KPIS, PRODUCT_SORTS, SNAPSHOT_KPIS


def Money(**kw):  # noqa: N802 - field factory
    return serializers.DecimalField(max_digits=14, decimal_places=2, **kw)


def Pct(**kw):  # noqa: N802
    return serializers.FloatField(**kw)


# ----------------------------------------------------------------------------------------------------------------
# query parameter serializers (documentation + validation of report-specific params)
# ----------------------------------------------------------------------------------------------------------------
class ProductsQuerySerializer(ReportQuerySerializer):
    ordering = serializers.ChoiceField(
        choices=[o for k in PRODUCT_SORTS for o in (k, f"-{k}")], required=False, default="-net"
    )


class InventoryQuerySerializer(ReportQuerySerializer):
    ordering = serializers.ChoiceField(
        choices=[o for k in INVENTORY_SORTS for o in (k, f"-{k}")], required=False, default="status"
    )
    status = serializers.RegexField(r"^(out|low|ok)$", required=False, help_text="Filter rows: out | low | ok")


# ----------------------------------------------------------------------------------------------------------------
# shared
# ----------------------------------------------------------------------------------------------------------------
class DefinitionSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    definition = serializers.CharField()


class PeriodSerializer(serializers.Serializer):
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    previous_date_from = serializers.DateField()
    previous_date_to = serializers.DateField()
    granularity = serializers.ChoiceField(choices=GRANULARITIES)
    branch = serializers.IntegerField(allow_null=True, help_text="Selected branch id, null = all branches in scope")
    timezones = serializers.ListField(
        child=serializers.CharField(), help_text="Time zone(s) of the branches in scope; days are branch-local"
    )


def _kpi_serializer(name: str, value_field, previous_field):
    return type(
        name,
        (serializers.Serializer,),
        {
            "value": value_field,
            "previous": previous_field,
            "delta_pct": Pct(allow_null=True, help_text="Change vs previous period in %, null when undefined"),
        },
    )


MoneyKpiSerializer = _kpi_serializer("MoneyKpi", Money(), Money(allow_null=True))
CountKpiSerializer = _kpi_serializer("CountKpi", serializers.IntegerField(), serializers.IntegerField(allow_null=True))


def _kpis_serializer():
    fields = {k: (MoneyKpiSerializer() if k in MONEY_KPIS else CountKpiSerializer()) for k in KPI_ORDER}
    return type("DashboardKpis", (serializers.Serializer,), fields)


DashboardKpisSerializer = _kpis_serializer()
assert set(SNAPSHOT_KPIS) <= set(KPI_ORDER)


# ----------------------------------------------------------------------------------------------------------------
# sales
# ----------------------------------------------------------------------------------------------------------------
class SalesBucketSerializer(serializers.Serializer):
    bucket = serializers.DateField(help_text="First day of the bucket (clipped to date_from), branch-local")
    orders = serializers.IntegerField(help_text="Orders counted as sales")
    gross_sales = Money()
    discounts = Money()
    delivery_fees = Money()
    tax = Money()
    refunds = Money()
    net_sales = Money()
    revenue_collected = Money()
    average_order_value = Money()


class SalesTotalsSerializer(serializers.Serializer):
    orders = serializers.IntegerField()
    gross_sales = Money()
    discounts = Money()
    delivery_fees = Money()
    tax = Money()
    refunds = Money()
    net_sales = Money()
    revenue_collected = Money()
    average_order_value = Money()


class SalesReportSerializer(serializers.Serializer):
    period = PeriodSerializer()
    totals = SalesTotalsSerializer()
    results = SalesBucketSerializer(many=True)


# ----------------------------------------------------------------------------------------------------------------
# orders by status
# ----------------------------------------------------------------------------------------------------------------
class StatusCountSerializer(serializers.Serializer):
    status = serializers.CharField()
    label = serializers.CharField()
    count = serializers.IntegerField()
    share = Pct(help_text="% of all orders placed in the period")


class OrdersByStatusTotalsSerializer(serializers.Serializer):
    orders_total = serializers.IntegerField()
    orders_counted = serializers.IntegerField()
    orders_completed = serializers.IntegerField()
    orders_pending = serializers.IntegerField()
    orders_cancelled = serializers.IntegerField()


class OrdersByStatusReportSerializer(serializers.Serializer):
    period = PeriodSerializer()
    totals = OrdersByStatusTotalsSerializer()
    results = StatusCountSerializer(many=True)


# ----------------------------------------------------------------------------------------------------------------
# products / categories
# ----------------------------------------------------------------------------------------------------------------
class ProductRowSerializer(serializers.Serializer):
    sku = serializers.CharField()
    product_name = serializers.CharField()
    category_name = serializers.CharField(allow_blank=True)
    units = serializers.IntegerField()
    orders = serializers.IntegerField()
    gross = Money()
    discounts = Money()
    net = Money(help_text="gross - discounts (refunds are not allocated to products)")
    share = Pct(help_text="% of total net")


class ItemTotalsSerializer(serializers.Serializer):
    units = serializers.IntegerField()
    orders = serializers.IntegerField(help_text="Distinct counted orders containing items")
    gross = Money()
    discounts = Money()
    net = Money()


class CategoryRowSerializer(serializers.Serializer):
    category = serializers.CharField()
    units = serializers.IntegerField()
    orders = serializers.IntegerField()
    gross = Money()
    discounts = Money()
    net = Money()
    share = Pct()


class PaginatedMixin(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)


class ProductsReportSerializer(PaginatedMixin):
    period = PeriodSerializer()
    totals = ItemTotalsSerializer()
    results = ProductRowSerializer(many=True)


class CategoriesReportSerializer(serializers.Serializer):
    period = PeriodSerializer()
    totals = ItemTotalsSerializer()
    results = CategoryRowSerializer(many=True)


# ----------------------------------------------------------------------------------------------------------------
# branches
# ----------------------------------------------------------------------------------------------------------------
class BranchRowSerializer(serializers.Serializer):
    branch_id = serializers.IntegerField()
    branch = serializers.CharField()
    timezone = serializers.CharField()
    orders_total = serializers.IntegerField()
    orders = serializers.IntegerField(help_text="Orders counted as sales")
    gross_sales = Money()
    discounts = Money()
    refunds = Money()
    net_sales = Money()
    revenue_collected = Money()
    average_order_value = Money()


class BranchTotalsSerializer(serializers.Serializer):
    orders_total = serializers.IntegerField()
    orders = serializers.IntegerField()
    gross_sales = Money()
    discounts = Money()
    refunds = Money()
    net_sales = Money()
    revenue_collected = Money()
    average_order_value = Money()


class BranchesReportSerializer(serializers.Serializer):
    period = PeriodSerializer()
    totals = BranchTotalsSerializer()
    results = BranchRowSerializer(many=True)


# ----------------------------------------------------------------------------------------------------------------
# promotions
# ----------------------------------------------------------------------------------------------------------------
class PromotionRowSerializer(serializers.Serializer):
    coupon_id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()
    discount_type = serializers.CharField()
    value = Money()
    is_automatic = serializers.BooleanField()
    is_active = serializers.BooleanField()
    redemptions = serializers.IntegerField(help_text="Non-voided redemptions on orders placed in the period")
    discount_given = Money()
    orders = serializers.IntegerField(help_text="Counted orders that used the coupon")
    revenue_influenced = Money(help_text="Collected revenue of those counted orders")


class PromotionTotalsSerializer(serializers.Serializer):
    redemptions = serializers.IntegerField()
    discount_given = Money()
    orders = serializers.IntegerField()
    revenue_influenced = Money()
    discounts = Money(help_text="All discounts on counted orders (equals the dashboard KPI)")
    orders_counted = serializers.IntegerField()


class PromotionsReportSerializer(PaginatedMixin):
    period = PeriodSerializer()
    totals = PromotionTotalsSerializer()
    results = PromotionRowSerializer(many=True)


# ----------------------------------------------------------------------------------------------------------------
# payments
# ----------------------------------------------------------------------------------------------------------------
class PaymentRowSerializer(serializers.Serializer):
    provider = serializers.CharField()
    status = serializers.CharField()
    is_sandbox = serializers.BooleanField()
    count = serializers.IntegerField()
    amount = Money()
    refunded = Money()


class PaymentFailureSerializer(serializers.Serializer):
    provider = serializers.CharField()
    failure_code = serializers.CharField(allow_blank=True)
    count = serializers.IntegerField()
    amount = Money()


class PaymentTotalsSerializer(serializers.Serializer):
    payments = serializers.IntegerField()
    amount = Money()
    settled_payments = serializers.IntegerField()
    settled_amount = Money()
    refunded_amount = Money()
    collected_amount = Money(help_text="settled amount - refunded amount")
    payment_failures = serializers.IntegerField(help_text="Equals the dashboard KPI")
    failed_amount = Money()
    failure_rate = Pct(help_text="% of payment attempts that failed")
    sandbox_payments = serializers.IntegerField()
    includes_sandbox = serializers.BooleanField(help_text="True when sandbox (no real money) payments are included")


class PaymentsReportSerializer(serializers.Serializer):
    period = PeriodSerializer()
    totals = PaymentTotalsSerializer()
    results = PaymentRowSerializer(many=True)
    failures = PaymentFailureSerializer(many=True, help_text="Top failure reasons")


# ----------------------------------------------------------------------------------------------------------------
# refunds
# ----------------------------------------------------------------------------------------------------------------
class RefundRowSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    order_number = serializers.CharField()
    order_status = serializers.CharField()
    provider = serializers.CharField()
    is_sandbox = serializers.BooleanField()
    amount = Money()
    status = serializers.CharField()
    reason = serializers.CharField(allow_blank=True)
    failure_message = serializers.CharField(allow_blank=True)
    counted_in_sales = serializers.BooleanField(help_text="False for refunds on cancelled orders")
    created_at = serializers.DateTimeField()


class CancellationRowSerializer(serializers.Serializer):
    number = serializers.CharField()
    placed_at = serializers.DateTimeField()
    cancelled_at = serializers.DateTimeField(allow_null=True)
    cancel_reason = serializers.CharField(allow_blank=True)
    payment_status = serializers.CharField()
    total = Money()
    refunded_total = Money()
    refund_needed = serializers.BooleanField()
    amount_to_refund = Money()


class RefundTotalsSerializer(serializers.Serializer):
    refunds = Money(help_text="Refunds on counted orders (equals the dashboard KPI)")
    refund_rows = serializers.IntegerField()
    refunded_amount = Money(help_text="Succeeded refunds on every order placed in the period")
    pending_amount = Money()
    failed_refunds = serializers.IntegerField()
    cancelled_orders = serializers.IntegerField()
    cancelled_value = Money()
    cancelled_paid_unrefunded = serializers.IntegerField(help_text="Cancelled in the period, paid, not fully refunded")
    cancelled_unrefunded_amount = Money()
    refund_needed_orders = serializers.IntegerField(help_text="All time, equals dashboard attention.refund_needed")


class RefundsReportSerializer(PaginatedMixin):
    period = PeriodSerializer()
    totals = RefundTotalsSerializer()
    results = RefundRowSerializer(many=True)
    cancellations = CancellationRowSerializer(many=True, help_text="Latest 100 cancelled orders in the period")


# ----------------------------------------------------------------------------------------------------------------
# inventory
# ----------------------------------------------------------------------------------------------------------------
class StockRowSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    branch_id = serializers.IntegerField()
    branch_name = serializers.CharField()
    product_id = serializers.IntegerField()
    product_name = serializers.CharField()
    sku = serializers.CharField()
    category_name = serializers.CharField()
    is_active = serializers.BooleanField(help_text="Whether the product is published")
    quantity = serializers.IntegerField()
    low_stock_threshold = serializers.IntegerField()
    unit_cost = Money(allow_null=True)
    value = Money(allow_null=True, help_text="quantity x unit cost; null without a unit cost")
    status = serializers.CharField(help_text="out | low | ok")


class MovementSummarySerializer(serializers.Serializer):
    movement_type = serializers.CharField()
    label = serializers.CharField()
    movements = serializers.IntegerField()
    units_in = serializers.IntegerField()
    units_out = serializers.IntegerField()
    net_units = serializers.IntegerField()


class InventoryTotalsSerializer(serializers.Serializer):
    stock_items = serializers.IntegerField()
    units_on_hand = serializers.IntegerField()
    stock_value = Money()
    items_without_cost = serializers.IntegerField()
    low_stock_items = serializers.IntegerField(help_text="Branch/product rows low on stock")
    out_of_stock_items = serializers.IntegerField()
    low_stock_products = serializers.IntegerField(help_text="Distinct active products; equals the dashboard KPI")
    out_of_stock_products = serializers.IntegerField()


class InventoryReportSerializer(PaginatedMixin):
    period = PeriodSerializer()
    totals = InventoryTotalsSerializer()
    results = StockRowSerializer(many=True)
    low_stock = StockRowSerializer(many=True, help_text="Up to 50 out-of-stock / low rows of active products")
    movements = MovementSummarySerializer(many=True, help_text="Stock movements created in the period, by type")


# ----------------------------------------------------------------------------------------------------------------
# customers
# ----------------------------------------------------------------------------------------------------------------
class FrequencyBucketSerializer(serializers.Serializer):
    bucket = serializers.ChoiceField(choices=["1", "2-3", "4+"])
    label = serializers.CharField()
    customers = serializers.IntegerField()
    share = Pct()


class SegmentSerializer(serializers.Serializer):
    segment = serializers.ChoiceField(choices=["new", "returning"])
    label = serializers.CharField()
    customers = serializers.IntegerField()
    share = Pct()


class TopCustomerSerializer(serializers.Serializer):
    customer_id = serializers.IntegerField()
    name = serializers.CharField(help_text="First name and last initial")
    email = serializers.CharField(allow_blank=True, help_text="Masked, e.g. j***@example.com")
    phone = serializers.CharField(allow_blank=True, help_text="Masked, last two digits only")
    orders = serializers.IntegerField()
    spend = Money(help_text="Collected revenue of counted orders in the period")
    last_order_at = serializers.DateTimeField()


class CustomerTotalsSerializer(serializers.Serializer):
    customers = serializers.IntegerField(help_text="Customers with a counted order in the period")
    new_customers = serializers.IntegerField()
    returning_customers = serializers.IntegerField()
    orders = serializers.IntegerField(help_text="Counted orders; equals the dashboard KPI")
    revenue_collected = Money()
    net_sales = Money()
    orders_per_customer = Pct()


class CustomersReportSerializer(serializers.Serializer):
    period = PeriodSerializer()
    totals = CustomerTotalsSerializer()
    results = FrequencyBucketSerializer(many=True, help_text="Customers by number of counted orders in the period")
    new_vs_returning = SegmentSerializer(many=True)
    top_customers = TopCustomerSerializer(many=True, help_text="Top 20 by spend, contact details masked")


# ----------------------------------------------------------------------------------------------------------------
# dashboard
# ----------------------------------------------------------------------------------------------------------------
class SeriesPointSerializer(SalesBucketSerializer):
    pass


class CategorySalesSerializer(CategoryRowSerializer):
    pass


class TopProductSerializer(serializers.Serializer):
    sku = serializers.CharField()
    product_name = serializers.CharField()
    units = serializers.IntegerField()
    revenue = Money(help_text="Line totals minus item discounts")


class TopProductsSerializer(serializers.Serializer):
    by_units = TopProductSerializer(many=True)
    by_revenue = TopProductSerializer(many=True)


class RecentOrderSerializer(serializers.Serializer):
    number = serializers.CharField()
    customer = serializers.CharField(help_text="First name and last initial")
    branch = serializers.CharField()
    total = Money()
    status = serializers.CharField()
    payment_status = serializers.CharField()
    placed_at = serializers.DateTimeField()


class RecentCustomerSerializer(serializers.Serializer):
    name = serializers.CharField(help_text="First name and last initial")
    joined_at = serializers.DateTimeField()


class AttentionSerializer(serializers.Serializer):
    stuck_orders = serializers.IntegerField()
    failed_payments = serializers.IntegerField()
    refund_needed = serializers.IntegerField()
    low_stock = serializers.IntegerField(help_text="Distinct products that are low or out of stock")


class DashboardSerializer(serializers.Serializer):
    period = PeriodSerializer()
    kpis = DashboardKpisSerializer()
    series = SeriesPointSerializer(many=True)
    orders_by_status = StatusCountSerializer(many=True)
    category_sales = CategorySalesSerializer(many=True, help_text="Top 10 categories by net")
    top_products = TopProductsSerializer()
    branch_performance = BranchRowSerializer(many=True)
    recent_orders = RecentOrderSerializer(many=True)
    recent_customers = RecentCustomerSerializer(many=True)
    attention = AttentionSerializer()
    generated_at = serializers.DateTimeField()
    is_demo_data = serializers.BooleanField(help_text="True when any counted order in the period is seeded demo data")
