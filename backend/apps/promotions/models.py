from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Upper


class Coupon(models.Model):
    """Coupon code or automatic promotion (is_automatic=True, no code entry needed)."""

    class DiscountType(models.TextChoices):
        PERCENT = "PERCENT", "Percentage"
        FIXED = "FIXED", "Fixed amount"

    class AppliesTo(models.TextChoices):
        ALL = "ALL", "Entire order"
        CATEGORIES = "CATEGORIES", "Selected categories"
        PRODUCTS = "PRODUCTS", "Selected products"

    code = models.CharField(max_length=40, help_text="Stored upper-case; matched case-insensitively")
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    discount_type = models.CharField(max_length=8, choices=DiscountType.choices)
    value = models.DecimalField(max_digits=8, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    max_discount = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    min_order_total = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)]
    )
    applies_to = models.CharField(max_length=12, choices=AppliesTo.choices, default=AppliesTo.ALL)
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="coupons")
    products = models.ManyToManyField("catalog.Product", blank=True, related_name="coupons")
    first_order_only = models.BooleanField(default=False)
    is_automatic = models.BooleanField(default=False)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    usage_limit = models.PositiveIntegerField(null=True, blank=True, help_text="Total redemptions allowed")
    per_customer_limit = models.PositiveIntegerField(null=True, blank=True)
    times_redeemed = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(Upper("code"), name="coupon_code_ci_unique"),
            models.CheckConstraint(
                condition=Q(discount_type="FIXED") | Q(value__lte=100), name="coupon_percent_max_100"
            ),
            models.CheckConstraint(
                condition=Q(ends_at__isnull=True) | Q(starts_at__isnull=True) | Q(ends_at__gt=F("starts_at")),
                name="coupon_valid_window",
            ),
        ]

    def save(self, *args, **kwargs):
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.code


class CouponRedemption(models.Model):
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name="redemptions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="coupon_redemptions")
    order = models.OneToOneField("orders.Order", on_delete=models.CASCADE, related_name="coupon_redemption")
    discount_amount = models.DecimalField(max_digits=8, decimal_places=2)
    is_voided = models.BooleanField(default=False, help_text="Order cancelled/expired — redemption no longer counts")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["coupon", "user"])]
