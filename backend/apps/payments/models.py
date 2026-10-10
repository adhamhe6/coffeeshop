from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q


class Payment(models.Model):
    """One payment attempt for an order. An order may have several FAILED/CANCELLED attempts but at most one live success."""

    class Provider(models.TextChoices):
        STRIPE = "stripe", "Card (Stripe)"
        DEMO = "demo", "Sandbox (demo, no real money)"
        CASH = "cash", "Pay at pickup / on delivery"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        REQUIRES_ACTION = "REQUIRES_ACTION", "Requires action"
        AUTHORIZED = "AUTHORIZED", "Authorized"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"
        PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially refunded"
        REFUNDED = "REFUNDED", "Refunded"

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="payments")
    provider = models.CharField(max_length=10, choices=Provider.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3)
    reference = models.CharField(max_length=120, blank=True, help_text="Provider session / intent id")
    provider_charge_id = models.CharField(max_length=120, blank=True)
    idempotency_key = models.CharField(max_length=80, unique=True)
    is_sandbox = models.BooleanField(default=False)
    failure_code = models.CharField(max_length=60, blank=True)
    failure_message = models.CharField(max_length=300, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    action_url = models.URLField(
        max_length=2000, blank=True, help_text="Hosted payment page the customer is redirected to (if any)"
    )
    expires_at = models.DateTimeField(null=True, blank=True, help_text="When the hosted payment page stops working")
    flagged_reason = models.CharField(
        max_length=40,
        blank=True,
        db_index=True,
        help_text="Set when staff must look at this attempt: duplicate_charge | amount_mismatch | unknown",
    )
    refunded_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "reference"], condition=~Q(reference=""), name="payment_provider_reference_unique"
            ),
            # DB-level guard against double charging: only one settled payment per order.
            models.UniqueConstraint(
                fields=["order"],
                condition=Q(status__in=["AUTHORIZED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"]),
                name="one_settled_payment_per_order",
            ),
            models.CheckConstraint(condition=Q(amount__gt=0), name="payment_amount_positive"),
            models.CheckConstraint(condition=Q(refunded_total__gte=0), name="payment_refunded_non_negative"),
        ]
        indexes = [models.Index(fields=["provider", "status", "-created_at"])]


class PaymentEvent(models.Model):
    """Audit/idempotency log of every provider event received. (provider, event_id) is unique so replays are no-ops."""

    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.SET_NULL, related_name="events")
    provider = models.CharField(max_length=10)
    event_id = models.CharField(max_length=120)
    event_type = models.CharField(max_length=80)
    payload = models.JSONField(default=dict, help_text="Sanitised: no card data, no secrets")
    outcome = models.CharField(
        max_length=40, blank=True, help_text="applied | duplicate | ignored | out_of_order | error"
    )
    error = models.CharField(max_length=300, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-received_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["provider", "event_id"], name="paymentevent_unique_provider_event")
        ]


class Refund(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"

    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    reference = models.CharField(max_length=120, blank=True)
    idempotency_key = models.CharField(max_length=80, unique=True)
    failure_message = models.CharField(max_length=300, blank=True)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="refund_amount_positive")]
