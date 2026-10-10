from rest_framework import serializers

from apps.orders.models import Order
from apps.promotions.models import Coupon

MONEY = {"max_digits": 10, "decimal_places": 2}


# ── input ────────────────────────────────────────────────────────────────────────────────────────────────────────────


class OptionIdsField(serializers.ListField):
    def __init__(self, **kwargs):
        kwargs.setdefault("child", serializers.IntegerField(min_value=1))
        kwargs.setdefault("max_length", 20)
        kwargs.setdefault("required", False)
        super().__init__(**kwargs)


class QuoteRequestSerializer(serializers.Serializer):
    option_ids = OptionIdsField(default=list)
    quantity = serializers.IntegerField(
        default=1, help_text="Valid range 1-50; out-of-range values are reported in errors."
    )
    branch_id = serializers.IntegerField(required=False, allow_null=True)


class CartItemCreateSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)
    option_ids = OptionIdsField(default=list)
    quantity = serializers.IntegerField(default=1)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class CartItemUpdateSerializer(serializers.Serializer):
    quantity = serializers.IntegerField(required=False)
    option_ids = OptionIdsField()
    note = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide quantity, option_ids or note.")
        return attrs


class CartPreviewRequestSerializer(serializers.Serializer):
    order_type = serializers.ChoiceField(choices=Order.Type.choices, default="PICKUP")
    branch_id = serializers.IntegerField(required=False, allow_null=True)
    address_id = serializers.IntegerField(required=False, allow_null=True)
    coupon_code = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    requested_for = serializers.DateTimeField(required=False, allow_null=True)


# ── output ───────────────────────────────────────────────────────────────────────────────────────────────────────────


class IssueSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    severity = serializers.ChoiceField(choices=["error", "warning"])
    item_id = serializers.IntegerField(required=False)
    group = serializers.CharField(required=False)
    data = serializers.DictField(required=False, help_text="Code-specific details (e.g. min_order_total, was/now)")


class OptionSnapshotSerializer(serializers.Serializer):
    group = serializers.CharField()
    name = serializers.CharField()
    price_delta = serializers.DecimalField(max_digits=6, decimal_places=2)


class ProductRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    slug = serializers.CharField()
    name = serializers.CharField()
    image = serializers.CharField(allow_null=True, help_text="Root-relative URL or null")
    is_available = serializers.BooleanField()


class PriceChangedSerializer(serializers.Serializer):
    was = serializers.DecimalField(**MONEY)
    now = serializers.DecimalField(**MONEY)


class CartItemSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    product = ProductRefSerializer()
    options = OptionSnapshotSerializer(many=True)
    quantity = serializers.IntegerField()
    unit_price = serializers.DecimalField(**MONEY)
    line_total = serializers.DecimalField(**MONEY)
    note = serializers.CharField(allow_blank=True)
    price_changed = PriceChangedSerializer(allow_null=True)
    issues = IssueSerializer(many=True)


class CartSerializer(serializers.Serializer):
    items = CartItemSerializer(many=True)
    item_count = serializers.IntegerField()
    subtotal = serializers.DecimalField(**MONEY)
    currency = serializers.CharField()
    issues = IssueSerializer(many=True)
    branch_id = serializers.IntegerField(allow_null=True)


class QuoteErrorSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    group = serializers.CharField(required=False)


class QuoteSerializer(serializers.Serializer):
    unit_price = serializers.DecimalField(**MONEY)
    base_price = serializers.DecimalField(**MONEY)
    quantity = serializers.IntegerField()
    options = OptionSnapshotSerializer(many=True)
    line_total = serializers.DecimalField(**MONEY)
    currency = serializers.CharField()
    valid = serializers.BooleanField()
    errors = QuoteErrorSerializer(many=True)


class PreviewLineSerializer(CartItemSerializer):
    discount = serializers.DecimalField(**MONEY)


class PreviewCouponSerializer(serializers.Serializer):
    code = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    discount_type = serializers.ChoiceField(choices=Coupon.DiscountType.choices)
    discount = serializers.DecimalField(**MONEY)
    is_automatic = serializers.BooleanField()


class CouponErrorSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()


class PreviewDeliverySerializer(serializers.Serializer):
    fee = serializers.DecimalField(**MONEY)
    min_order_total = serializers.DecimalField(**MONEY)
    eta_minutes = serializers.IntegerField()
    zone = serializers.CharField(allow_null=True)


class CartPreviewSerializer(serializers.Serializer):
    order_type = serializers.ChoiceField(choices=Order.Type.choices)
    branch_id = serializers.IntegerField(allow_null=True)
    currency = serializers.CharField()
    items = PreviewLineSerializer(many=True)
    item_count = serializers.IntegerField()
    subtotal = serializers.DecimalField(**MONEY)
    discount_total = serializers.DecimalField(**MONEY)
    delivery_fee = serializers.DecimalField(**MONEY)
    tax_total = serializers.DecimalField(**MONEY)
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2)
    tax_label = serializers.CharField()
    prices_include_tax = serializers.BooleanField()
    total = serializers.DecimalField(**MONEY)
    coupon = PreviewCouponSerializer(allow_null=True)
    coupon_error = CouponErrorSerializer(allow_null=True)
    delivery = PreviewDeliverySerializer(allow_null=True)
    requested_for = serializers.DateTimeField(allow_null=True)
    estimated_ready_at = serializers.DateTimeField(allow_null=True)
    issues = IssueSerializer(many=True)
    checkout_blockers = IssueSerializer(many=True)
    can_checkout = serializers.BooleanField()
