from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.cart.serializers import CartSerializer

from . import selectors
from .models import Order, OrderItem, OrderItemOption

MONEY = {"max_digits": 10, "decimal_places": 2}


# ── input ────────────────────────────────────────────────────────────────────────────────────────────────────────────


class CheckoutSerializer(serializers.Serializer):
    branch_id = serializers.IntegerField(min_value=1)
    order_type = serializers.ChoiceField(choices=Order.Type.choices)
    address_id = serializers.IntegerField(required=False, allow_null=True)
    requested_for = serializers.DateTimeField(
        required=False, allow_null=True, help_text="Null/omitted = as soon as possible"
    )
    coupon_code = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    payment_method = serializers.CharField(max_length=20, help_text="A key from GET /payments/methods/")
    customer_notes = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    accept_terms = serializers.BooleanField(help_text="Must be true")
    expected_total = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True, help_text="Total shown to the customer"
    )
    phone = serializers.RegexField(
        r"^[0-9+()\-\s.]{5,30}$",
        required=False,
        allow_blank=True,
        default="",
        error_messages={"invalid": "Enter a valid phone number."},
    )

    def validate_accept_terms(self, value):
        if value is not True:
            raise serializers.ValidationError("You must accept the terms to place an order.")
        return value

    def validate(self, attrs):
        if attrs["order_type"] == Order.Type.DELIVERY and not attrs.get("address_id"):
            raise serializers.ValidationError({"address_id": ["Choose a delivery address."]})
        return attrs


class CancelRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class PayRequestSerializer(serializers.Serializer):
    payment_method = serializers.CharField(max_length=20, required=False, allow_blank=True)


# ── output ───────────────────────────────────────────────────────────────────────────────────────────────────────────


class PaymentErrorSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()


class OrderPaymentSerializer(serializers.Serializer):
    status = serializers.CharField()
    provider = serializers.CharField()
    provider_label = serializers.CharField()
    is_sandbox = serializers.BooleanField()
    action = serializers.DictField(allow_null=True, help_text='{"type":"redirect","url":...} | {"type":"none"} | null')
    failure_message = serializers.CharField(allow_null=True)
    can_retry = serializers.BooleanField()
    error = PaymentErrorSerializer(allow_null=True, required=False)


class BranchRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()
    slug = serializers.CharField()
    address_line = serializers.CharField()
    city = serializers.CharField()
    phone = serializers.CharField(allow_blank=True)
    timezone = serializers.CharField()


class OrderItemOptionSerializer(serializers.ModelSerializer):
    group = serializers.CharField(source="group_name")
    name = serializers.CharField(source="option_name")

    class Meta:
        model = OrderItemOption
        fields = ["group", "name", "price_delta"]


class OrderItemSerializer(serializers.ModelSerializer):
    options = OrderItemOptionSerializer(many=True)
    product_slug = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "product_id",
            "product_slug",
            "product_name",
            "sku",
            "category_name",
            "image",
            "quantity",
            "base_price",
            "unit_price",
            "line_total",
            "discount_amount",
            "note",
            "options",
        ]

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_product_slug(self, obj):
        return obj.product.slug if obj.product else None

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_image(self, obj):
        product = obj.product
        return product.image.url if product and product.image else None


class HistoryEntrySerializer(serializers.Serializer):
    from_status = serializers.CharField(allow_blank=True)
    to_status = serializers.CharField()
    actor = serializers.ChoiceField(choices=["customer", "system", "staff"])
    note = serializers.CharField(allow_blank=True)
    created_at = serializers.DateTimeField()


class TimelineStepSerializer(serializers.Serializer):
    status = serializers.CharField()
    label = serializers.CharField()
    state = serializers.ChoiceField(choices=["done", "current", "upcoming", "cancelled"])
    at = serializers.DateTimeField(allow_null=True)


class OrderActionsSerializer(serializers.Serializer):
    can_cancel = serializers.BooleanField()
    can_pay = serializers.BooleanField()
    can_reorder = serializers.BooleanField()
    can_review = serializers.BooleanField()


class OrderListSerializer(serializers.ModelSerializer):
    branch = BranchRefSerializer()
    item_count = serializers.SerializerMethodField()
    items_preview = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "number",
            "status",
            "order_type",
            "payment_status",
            "payment_method",
            "currency",
            "total",
            "branch",
            "item_count",
            "items_preview",
            "requested_for",
            "estimated_ready_at",
            "placed_at",
            "is_demo",
        ]

    @extend_schema_field(serializers.IntegerField())
    def get_item_count(self, obj):
        return sum(i.quantity for i in obj.items.all())

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_items_preview(self, obj):
        return [f"{i.quantity} × {i.product_name}" for i in list(obj.items.all())[:3]]


class OrderDetailSerializer(serializers.ModelSerializer):
    branch = BranchRefSerializer()
    items = OrderItemSerializer(many=True)
    payment = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()
    timeline = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "number",
            "status",
            "order_type",
            "payment_status",
            "payment_method",
            "currency",
            "subtotal",
            "discount_total",
            "delivery_fee",
            "tax_total",
            "tax_rate",
            "prices_include_tax",
            "total",
            "refunded_total",
            "coupon_code",
            "branch",
            "items",
            "customer_name",
            "customer_email",
            "customer_phone",
            "delivery_address",
            "delivery_zone_name",
            "requested_for",
            "estimated_ready_at",
            "customer_notes",
            "placed_at",
            "confirmed_at",
            "completed_at",
            "cancelled_at",
            "cancel_reason",
            "is_demo",
            "payment",
            "history",
            "timeline",
            "actions",
        ]

    @extend_schema_field(OrderPaymentSerializer)
    def get_payment(self, obj):
        override = self.context.get("payment")
        if override is not None:
            return override
        from apps.payments.registry import describe_payment

        return describe_payment(obj)

    @extend_schema_field(HistoryEntrySerializer(many=True))
    def get_history(self, obj):
        return selectors.history_payload(obj)

    @extend_schema_field(TimelineStepSerializer(many=True))
    def get_timeline(self, obj):
        return selectors.build_timeline(obj)

    @extend_schema_field(OrderActionsSerializer)
    def get_actions(self, obj):
        return selectors.actions_for(obj)


class CheckoutResponseSerializer(serializers.Serializer):
    order = OrderDetailSerializer()
    payment = OrderPaymentSerializer()


class CancelResponseSerializer(serializers.Serializer):
    order = OrderDetailSerializer()
    refund_status = serializers.ChoiceField(
        choices=["not_applicable", "review_pending", "partially_refunded", "refunded"]
    )
    refund_message = serializers.CharField()


class SkippedItemSerializer(serializers.Serializer):
    name = serializers.CharField()
    reason = serializers.CharField()
    message = serializers.CharField()


class ReorderResponseSerializer(serializers.Serializer):
    cart = CartSerializer()
    skipped = SkippedItemSerializer(many=True)
