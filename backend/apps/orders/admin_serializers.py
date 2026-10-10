from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.permissions import has_capability
from apps.payments import services as payment_services
from apps.payments.admin_serializers import AdminPaymentDetailSerializer

from . import admin_filters as f
from . import state
from .models import Order, OrderItem, OrderItemOption, OrderNote, OrderStatusHistory


class AdminAttentionSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()


class AdminBranchRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class AdminOrderRowSerializer(serializers.ModelSerializer):
    branch = serializers.SerializerMethodField()
    item_count = serializers.IntegerField(read_only=True)
    age_minutes = serializers.SerializerMethodField()
    minutes_in_status = serializers.SerializerMethodField()
    is_stuck = serializers.SerializerMethodField()
    needs_attention = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "number",
            "placed_at",
            "customer_name",
            "branch",
            "order_type",
            "status",
            "payment_status",
            "payment_method",
            "total",
            "currency",
            "item_count",
            "age_minutes",
            "minutes_in_status",
            "is_stuck",
            "needs_attention",
            "requested_for",
            "is_demo",
        ]
        read_only_fields = fields

    @extend_schema_field(AdminBranchRefSerializer)
    def get_branch(self, obj):
        return {"id": obj.branch_id, "name": obj.branch.name}

    def get_age_minutes(self, obj) -> int:
        return f.minutes_since(obj.placed_at)

    def get_minutes_in_status(self, obj) -> int:
        return f.minutes_since(getattr(obj, "status_since", None) or obj.placed_at)

    def get_is_stuck(self, obj) -> bool:
        return f.is_stuck(obj)

    @extend_schema_field(AdminAttentionSerializer(allow_null=True))
    def get_needs_attention(self, obj):
        return f.attention(obj)


class AdminOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItemOption
        fields = ["group_name", "option_name", "price_delta"]
        read_only_fields = fields


class AdminItemSerializer(serializers.ModelSerializer):
    options = AdminOptionSerializer(many=True, read_only=True)

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "product_name",
            "sku",
            "category_name",
            "quantity",
            "base_price",
            "unit_price",
            "line_total",
            "discount_amount",
            "note",
            "options",
        ]
        read_only_fields = fields


class AdminHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderStatusHistory
        fields = ["from_status", "to_status", "actor_label", "note", "created_at"]
        read_only_fields = fields


class AdminNoteSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField()

    class Meta:
        model = OrderNote
        fields = ["id", "author", "body", "created_at"]
        read_only_fields = fields

    def get_author(self, obj) -> str | None:
        return obj.author.full_name if obj.author_id else None


class AdminCustomerSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    email = serializers.CharField()
    phone = serializers.CharField(allow_blank=True)


class AdminTotalsSerializer(serializers.Serializer):
    subtotal = serializers.DecimalField(max_digits=10, decimal_places=2)
    discount_total = serializers.DecimalField(max_digits=10, decimal_places=2)
    delivery_fee = serializers.DecimalField(max_digits=8, decimal_places=2)
    tax_total = serializers.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2)
    prices_include_tax = serializers.BooleanField()
    total = serializers.DecimalField(max_digits=10, decimal_places=2)
    refunded_total = serializers.DecimalField(max_digits=10, decimal_places=2)
    coupon_code = serializers.CharField(allow_blank=True)


class AdminPermissionsSerializer(serializers.Serializer):
    can_transition = serializers.BooleanField()
    can_cancel = serializers.BooleanField()
    can_note = serializers.BooleanField()
    can_refund = serializers.BooleanField()
    can_collect_cash = serializers.BooleanField()


class AdminOrderDetailSerializer(AdminOrderRowSerializer):
    customer = serializers.SerializerMethodField()
    totals = serializers.SerializerMethodField()
    items = AdminItemSerializer(many=True, read_only=True)
    payments = AdminPaymentDetailSerializer(many=True, read_only=True)
    history = AdminHistorySerializer(many=True, read_only=True)
    notes = AdminNoteSerializer(source="staff_notes", many=True, read_only=True)
    allowed_transitions = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            *AdminOrderRowSerializer.Meta.fields,
            "confirmed_at",
            "completed_at",
            "cancelled_at",
            "cancel_reason",
            "estimated_ready_at",
            "customer_notes",
            "delivery_address",
            "delivery_zone_name",
            "customer",
            "totals",
            "items",
            "payments",
            "history",
            "notes",
            "allowed_transitions",
            "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(AdminCustomerSerializer)
    def get_customer(self, obj):
        return {
            "id": obj.customer_id,
            "name": obj.customer_name,
            "email": obj.customer_email,
            "phone": obj.customer_phone,
        }

    @extend_schema_field(AdminTotalsSerializer)
    def get_totals(self, obj):
        return AdminTotalsSerializer(
            {
                "subtotal": obj.subtotal,
                "discount_total": obj.discount_total,
                "delivery_fee": obj.delivery_fee,
                "tax_total": obj.tax_total,
                "tax_rate": obj.tax_rate,
                "prices_include_tax": obj.prices_include_tax,
                "total": obj.total,
                "refunded_total": obj.refunded_total,
                "coupon_code": obj.coupon_code,
            }
        ).data

    def get_allowed_transitions(self, obj) -> list[str]:
        return state.allowed_transitions(obj)

    @extend_schema_field(AdminPermissionsSerializer)
    def get_permissions(self, obj):
        user = self.context["request"].user
        allowed = state.allowed_transitions(obj)
        payments = list(obj.payments.all())
        return {
            "can_transition": has_capability(user, "orders.manage")
            and any(t != Order.Status.CANCELLED for t in allowed),
            "can_cancel": has_capability(user, "orders.cancel") and Order.Status.CANCELLED in allowed,
            "can_note": has_capability(user, "orders.note"),
            "can_refund": has_capability(user, "payments.refund")
            and any(payment_services.refundable_amount(p) > 0 for p in payments),
            "can_collect_cash": (
                has_capability(user, "payments.collect")
                and obj.payment_method == "cash"
                and obj.status != Order.Status.CANCELLED
                and not any(p.status in payment_services.SETTLED for p in payments)
            ),
        }


class AdminTransitionRequestSerializer(serializers.Serializer):
    to_status = serializers.CharField(max_length=20, help_text="One of the Order status values.")

    def validate_to_status(self, value):
        value = value.strip().upper()
        if value not in Order.Status.values:
            raise serializers.ValidationError("Unknown order status.")
        return value

    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class AdminCancelRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200, allow_blank=False, trim_whitespace=True)
    refund = serializers.BooleanField(
        required=False, default=False, help_text="Also refund the settled payment (needs payments.refund)."
    )


class AdminRefundOutcomeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=["NOT_REQUESTED", "NOT_APPLICABLE", "ALREADY_REFUNDED", "SUCCEEDED", "PENDING", "FAILED"],
        help_text="The real outcome of the refund attempt; cancellation succeeds independently of it.",
    )
    message = serializers.CharField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    refund_id = serializers.IntegerField(allow_null=True)
    payment_id = serializers.IntegerField(allow_null=True)


class AdminCancelResponseSerializer(serializers.Serializer):
    order = AdminOrderDetailSerializer()
    refund = AdminRefundOutcomeSerializer()


class AdminNoteRequestSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)


class AdminQueueStatusSerializer(serializers.Serializer):
    status = serializers.CharField()
    label = serializers.CharField()
    count = serializers.IntegerField()
    stuck_count = serializers.IntegerField()
    oldest_age_minutes = serializers.IntegerField(
        allow_null=True, help_text="Minutes the oldest order has been in this status."
    )


class AdminQueueTotalsSerializer(serializers.Serializer):
    active = serializers.IntegerField()
    stuck = serializers.IntegerField()


class AdminQueueSerializer(serializers.Serializer):
    generated_at = serializers.DateTimeField()
    branch_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_null=True, help_text="null = all branches"
    )
    statuses = AdminQueueStatusSerializer(many=True)
    totals = AdminQueueTotalsSerializer()
    stuck_rules_minutes = serializers.DictField(child=serializers.IntegerField())
