from django.conf import settings
from django.db import models
from django.db.models import Q


class BranchProduct(models.Model):
    """Per-branch availability for PREPARED products (the 'we're out of this today' toggle). Absence of a row = available."""

    branch = models.ForeignKey("branches.Branch", on_delete=models.CASCADE, related_name="product_availability")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="branch_availability")
    is_available = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["branch", "product"], name="branchproduct_unique")]


class StockItem(models.Model):
    """Quantity on hand for a STOCKED product at a branch. Mutated only through apps.inventory.services."""

    branch = models.ForeignKey("branches.Branch", on_delete=models.CASCADE, related_name="stock_items")
    product = models.ForeignKey("catalog.Product", on_delete=models.CASCADE, related_name="stock_items")
    quantity = models.IntegerField(default=0)
    low_stock_threshold = models.PositiveIntegerField(default=5)
    unit_cost = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True, help_text="For valuation reports"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["branch", "product"], name="stockitem_unique"),
            models.CheckConstraint(condition=Q(quantity__gte=0), name="stockitem_quantity_non_negative"),
        ]
        indexes = [models.Index(fields=["branch", "quantity"])]

    @property
    def is_low(self) -> bool:
        return self.quantity <= self.low_stock_threshold


class InventoryMovement(models.Model):
    class Type(models.TextChoices):
        RECEIPT = "RECEIPT", "Stock receipt"
        ADJUSTMENT = "ADJUSTMENT", "Manual adjustment"
        SALE = "SALE", "Sale (order placed)"
        RETURN = "RETURN", "Returned to stock (cancelled/expired order)"
        WASTE = "WASTE", "Waste / spoilage"
        INITIAL = "INITIAL", "Initial stock"

    stock_item = models.ForeignKey(StockItem, on_delete=models.CASCADE, related_name="movements")
    movement_type = models.CharField(max_length=12, choices=Type.choices)
    quantity_delta = models.IntegerField()
    quantity_after = models.IntegerField()
    reference = models.CharField(max_length=60, blank=True, help_text="Order number, PO number…")
    reason = models.CharField(max_length=200, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=~Q(quantity_delta=0), name="movement_nonzero_delta"),
            models.CheckConstraint(condition=Q(quantity_after__gte=0), name="movement_after_non_negative"),
        ]
