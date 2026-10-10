import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class Cart(models.Model):
    """One active cart per authenticated customer, or per anonymous browser (identified by an HttpOnly cookie token)."""

    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="cart"
    )
    branch = models.ForeignKey("branches.Branch", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)


class CartItem(models.Model):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="+")
    options = models.ManyToManyField("catalog.ModifierOption", blank=True, related_name="+")
    signature = models.CharField(
        max_length=64, help_text="sha1 of product id + sorted option ids; merges identical lines"
    )
    quantity = models.PositiveSmallIntegerField()
    note = models.CharField(max_length=200, blank=True)
    unit_price_seen = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        help_text="Price shown to the customer when added; used to warn on price changes",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["cart", "signature"], name="cartitem_unique_signature"),
            models.CheckConstraint(condition=Q(quantity__gte=1, quantity__lte=50), name="cartitem_quantity_range"),
        ]
