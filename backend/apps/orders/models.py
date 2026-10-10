from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Order(models.Model):
    class Type(models.TextChoices):
        PICKUP = "PICKUP", "Pickup"
        DELIVERY = "DELIVERY", "Delivery"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        CONFIRMED = "CONFIRMED", "Confirmed"
        PREPARING = "PREPARING", "Preparing"
        READY_FOR_PICKUP = "READY_FOR_PICKUP", "Ready for pickup"
        OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY", "Out for delivery"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        REQUIRES_ACTION = "REQUIRES_ACTION", "Requires action"
        AUTHORIZED = "AUTHORIZED", "Authorized"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially refunded"
        REFUNDED = "REFUNDED", "Refunded"

    number = models.CharField(max_length=24, unique=True, help_text="Human-readable, e.g. DT-260512-0042")
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders")
    branch = models.ForeignKey("branches.Branch", on_delete=models.PROTECT, related_name="orders")
    order_type = models.CharField(max_length=10, choices=Type.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    payment_status = models.CharField(
        max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING, db_index=True
    )
    payment_method = models.CharField(max_length=20, help_text="Provider key: stripe | demo | cash")
    currency = models.CharField(max_length=3)

    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    discount_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    delivery_fee = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    tax_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    prices_include_tax = models.BooleanField(default=False)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    refunded_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    coupon = models.ForeignKey(
        "promotions.Coupon", null=True, blank=True, on_delete=models.SET_NULL, related_name="orders"
    )
    coupon_code = models.CharField(max_length=40, blank=True, help_text="Snapshot")

    customer_name = models.CharField(max_length=160)
    customer_email = models.EmailField()
    customer_phone = models.CharField(max_length=30, blank=True)
    delivery_address = models.JSONField(null=True, blank=True, help_text="Snapshot of the address used for delivery")
    delivery_zone_name = models.CharField(max_length=80, blank=True)
    requested_for = models.DateTimeField(null=True, blank=True, help_text="Null = as soon as possible")
    estimated_ready_at = models.DateTimeField(null=True, blank=True)
    customer_notes = models.CharField(max_length=300, blank=True)
    terms_accepted_at = models.DateTimeField(null=True, blank=True)

    idempotency_key = models.CharField(max_length=64)
    is_demo = models.BooleanField(default=False, help_text="Seeded demonstration order")
    placed_at = models.DateTimeField(db_index=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=200, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-placed_at", "-id"]
        indexes = [
            models.Index(fields=["branch", "status", "-placed_at"]),
            models.Index(fields=["customer", "-placed_at"]),
            models.Index(fields=["payment_status", "status"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["customer", "idempotency_key"], name="order_idempotency_per_customer"),
            models.CheckConstraint(condition=Q(total__gte=0), name="order_total_non_negative"),
            models.CheckConstraint(
                condition=Q(discount_total__gte=0) & Q(discount_total__lte=F("subtotal")), name="order_discount_bounds"
            ),
            models.CheckConstraint(
                condition=Q(refunded_total__gte=0) & Q(refunded_total__lte=F("total")), name="order_refund_bounds"
            ),
            models.CheckConstraint(
                condition=Q(order_type="PICKUP") | Q(delivery_address__isnull=False),
                name="order_delivery_requires_address",
            ),
        ]

    def __str__(self):
        return self.number


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", null=True, on_delete=models.SET_NULL, related_name="order_items")
    product_name = models.CharField(max_length=120)
    sku = models.CharField(max_length=40)
    category_name = models.CharField(max_length=80, blank=True)
    base_price = models.DecimalField(max_digits=8, decimal_places=2)
    unit_price = models.DecimalField(max_digits=8, decimal_places=2, help_text="Base price + option deltas")
    quantity = models.PositiveSmallIntegerField()
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gte=1), name="orderitem_quantity_positive"),
            models.CheckConstraint(
                condition=Q(unit_price__gte=0) & Q(line_total__gte=0), name="orderitem_amounts_non_negative"
            ),
        ]


class OrderItemOption(models.Model):
    item = models.ForeignKey(OrderItem, on_delete=models.CASCADE, related_name="options")
    option = models.ForeignKey("catalog.ModifierOption", null=True, on_delete=models.SET_NULL, related_name="+")
    group_name = models.CharField(max_length=60)
    option_name = models.CharField(max_length=60)
    price_delta = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        ordering = ["id"]


class OrderStatusHistory(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="history")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    actor_label = models.CharField(max_length=160, blank=True, help_text="'system', 'customer', or staff name")
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class OrderNote(models.Model):
    """Internal staff note; never visible to the customer."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="staff_notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    body = models.TextField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
