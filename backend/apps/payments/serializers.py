from rest_framework import serializers

from .providers.demo import OUTCOMES


class PaymentMethodSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    description = serializers.CharField()
    is_sandbox = serializers.BooleanField(help_text="True when no real money moves (demo provider or test-mode keys).")
    offline = serializers.BooleanField(help_text="Settled outside the website (cash at pickup/delivery).")


class PaymentActionSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["redirect", "none"])
    url = serializers.CharField(required=False, help_text="Hosted payment page when type=redirect.")


class PaymentSummarySerializer(serializers.Serializer):
    """Shape returned by `apps.payments.registry.describe_payment(order)`; embedded in order payloads."""

    status = serializers.ChoiceField(
        choices=["PENDING", "REQUIRES_ACTION", "AUTHORIZED", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"]
    )
    provider = serializers.CharField()
    provider_label = serializers.CharField()
    is_sandbox = serializers.BooleanField()
    action = PaymentActionSerializer(allow_null=True)
    failure_message = serializers.CharField(allow_null=True)
    can_retry = serializers.BooleanField()


class PaymentSyncResponseSerializer(serializers.Serializer):
    order_number = serializers.CharField()
    order_status = serializers.CharField()
    payment = PaymentSummarySerializer()


class DemoItemSerializer(serializers.Serializer):
    name = serializers.CharField()
    quantity = serializers.IntegerField()
    line_total = serializers.DecimalField(max_digits=10, decimal_places=2)


class DemoPaymentSerializer(serializers.Serializer):
    reference = serializers.CharField()
    order_number = serializers.CharField()
    total = serializers.DecimalField(max_digits=10, decimal_places=2)
    currency = serializers.CharField()
    items = DemoItemSerializer(many=True)
    status = serializers.CharField(help_text="Payment status.")
    order_status = serializers.CharField()
    can_complete = serializers.BooleanField(help_text="False once the attempt is settled, failed or cancelled.")
    sandbox = serializers.BooleanField()
    notice = serializers.CharField()


class DemoCompleteRequestSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=sorted(OUTCOMES))


class DemoCompleteResponseSerializer(serializers.Serializer):
    outcome = serializers.CharField()
    payment_status = serializers.CharField()
    order_number = serializers.CharField()
    order_status = serializers.CharField()
    order_payment_status = serializers.CharField()
    can_retry = serializers.BooleanField()
    sandbox = serializers.BooleanField()
    event_outcome = serializers.CharField(allow_blank=True)


class WebhookAckSerializer(serializers.Serializer):
    received = serializers.BooleanField()
    outcome = serializers.CharField()
