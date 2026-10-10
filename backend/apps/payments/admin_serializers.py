from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.permissions import has_capability

from . import services
from .models import Payment, PaymentEvent, Refund
from .registry import get_provider


class AdminPaymentEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentEvent
        fields = ["id", "event_id", "event_type", "outcome", "error", "received_at", "processed_at"]
        read_only_fields = fields


class AdminRefundSerializer(serializers.ModelSerializer):
    initiated_by = serializers.SerializerMethodField()

    class Meta:
        model = Refund
        fields = [
            "id",
            "amount",
            "reason",
            "status",
            "reference",
            "failure_message",
            "initiated_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_initiated_by(self, obj) -> str | None:
        return obj.initiated_by.email if obj.initiated_by_id else None


class OrderBriefSerializer(serializers.Serializer):
    number = serializers.CharField()
    status = serializers.CharField()
    payment_status = serializers.CharField()
    order_type = serializers.CharField()
    total = serializers.DecimalField(max_digits=10, decimal_places=2)
    refunded_total = serializers.DecimalField(max_digits=10, decimal_places=2)
    customer_name = serializers.CharField()
    customer_email = serializers.CharField()
    branch_id = serializers.IntegerField()
    branch_name = serializers.CharField()


class AdminPaymentSerializer(serializers.ModelSerializer):
    """List row. `AdminPaymentDetailSerializer` adds events and refunds."""

    provider_label = serializers.SerializerMethodField()
    order = serializers.SerializerMethodField()
    refundable_amount = serializers.SerializerMethodField()
    needs_refund = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id",
            "provider",
            "provider_label",
            "status",
            "amount",
            "currency",
            "reference",
            "provider_charge_id",
            "is_sandbox",
            "failure_code",
            "failure_message",
            "flagged_reason",
            "paid_at",
            "refunded_total",
            "refundable_amount",
            "needs_refund",
            "created_at",
            "updated_at",
            "order",
        ]
        read_only_fields = fields

    def get_provider_label(self, obj) -> str:
        return obj.get_provider_display()

    @extend_schema_field(OrderBriefSerializer)
    def get_order(self, obj):
        o = obj.order
        return OrderBriefSerializer(
            {
                "number": o.number,
                "status": o.status,
                "payment_status": o.payment_status,
                "order_type": o.order_type,
                "total": o.total,
                "refunded_total": o.refunded_total,
                "customer_name": o.customer_name,
                "customer_email": o.customer_email,
                "branch_id": o.branch_id,
                "branch_name": o.branch.name,
            }
        ).data

    @extend_schema_field(serializers.DecimalField(max_digits=10, decimal_places=2))
    def get_refundable_amount(self, obj):
        return str(services.refundable_amount(obj))

    def get_needs_refund(self, obj) -> bool:
        return needs_refund(obj)


def needs_refund(payment: Payment) -> bool:
    """Money is held for a cancelled order (or a duplicate charge) and not fully handed back yet."""
    if payment.flagged_reason == services.DUPLICATE_CHARGE:
        return payment.refunded_total < payment.amount
    return payment.order.status == "CANCELLED" and payment.status in ("PAID", "PARTIALLY_REFUNDED")


class AdminPaymentDetailSerializer(AdminPaymentSerializer):
    events = serializers.SerializerMethodField()
    refunds = AdminRefundSerializer(many=True, read_only=True)
    can_refund = serializers.SerializerMethodField()
    provider_is_available = serializers.SerializerMethodField()

    class Meta(AdminPaymentSerializer.Meta):
        fields = [*AdminPaymentSerializer.Meta.fields, "events", "refunds", "can_refund", "provider_is_available"]
        read_only_fields = fields

    @extend_schema_field(AdminPaymentEventSerializer(many=True))
    def get_events(self, obj):
        events = list(obj.events.all()[:100])
        return AdminPaymentEventSerializer(events, many=True).data

    def get_can_refund(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and has_capability(request.user, "payments.refund") and services.refundable_amount(obj) > 0)

    def get_provider_is_available(self, obj) -> bool:
        try:
            get_provider(obj.provider)
        except Exception:  # noqa: BLE001
            return False
        return True


class RefundRequestSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        required=False,
        min_value=Decimal("0.01"),
        help_text="Defaults to everything that can still be refunded.",
    )
    reason = serializers.CharField(max_length=200, allow_blank=False, trim_whitespace=True)


class RefundResultSerializer(serializers.Serializer):
    refund = AdminRefundSerializer()
    payment = AdminPaymentDetailSerializer()
