from decimal import Decimal

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


class Category(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(unique=True)
    description = models.CharField(max_length=300, blank=True)
    image = models.ImageField(upload_to="categories/", blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Tag(models.Model):
    name = models.CharField(max_length=40, unique=True)
    slug = models.SlugField(unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Product(models.Model):
    class Type(models.TextChoices):
        BEVERAGE = "BEVERAGE", "Beverage"
        FOOD = "FOOD", "Food"
        BEANS = "BEANS", "Coffee beans"
        MERCH = "MERCH", "Equipment & merchandise"
        GIFT = "GIFT", "Gift set / bundle"

    class StockMode(models.TextChoices):
        PREPARED = "PREPARED", "Prepared to order (availability toggle per branch)"
        STOCKED = "STOCKED", "Stock-managed (quantity per branch)"

    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    sku = models.CharField(max_length=40, unique=True)
    product_type = models.CharField(max_length=10, choices=Type.choices, default=Type.BEVERAGE)
    short_description = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    base_price = models.DecimalField(max_digits=8, decimal_places=2, validators=[MinValueValidator(Decimal("0.00"))])
    image = models.ImageField(upload_to="products/", blank=True)
    is_active = models.BooleanField(default=True, help_text="Unpublished/archived products are never purchasable")
    is_featured = models.BooleanField(default=False)
    is_bestseller = models.BooleanField(default=False)
    is_seasonal = models.BooleanField(default=False)
    is_new = models.BooleanField(default=False)
    is_sold_out = models.BooleanField(default=False, help_text="Global 'sold out' toggle across all branches")
    stock_mode = models.CharField(max_length=10, choices=StockMode.choices, default=StockMode.PREPARED)
    prep_minutes = models.PositiveSmallIntegerField(default=5)
    calories = models.PositiveIntegerField(null=True, blank=True)
    caffeine_mg = models.PositiveIntegerField(null=True, blank=True)
    allergens = ArrayField(models.CharField(max_length=30), default=list, blank=True)
    nutrition = models.JSONField(default=dict, blank=True)
    tags = models.ManyToManyField(Tag, blank=True, related_name="products")
    modifier_groups = models.ManyToManyField(
        "ModifierGroup", through="ProductModifierGroup", related_name="products", blank=True
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_demo = models.BooleanField(default=False, help_text="Created by the seed command")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category__sort_order", "sort_order", "name"]
        indexes = [
            models.Index(fields=["is_active", "category"]),
            models.Index(fields=["is_active", "is_featured"]),
            models.Index(fields=["is_active", "is_bestseller"]),
            # typo-tolerant storefront search (pg_trgm similarity on the name)
            GinIndex(fields=["name"], name="product_name_trgm", opclasses=["gin_trgm_ops"]),
        ]
        constraints = [models.CheckConstraint(condition=Q(base_price__gte=0), name="product_price_non_negative")]

    def __str__(self):
        return self.name


class ProductImage(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="gallery")
    image = models.ImageField(upload_to="products/gallery/")
    alt_text = models.CharField(max_length=160, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]


class ModifierGroup(models.Model):
    """Reusable group of options (Size, Milk, Syrup…). Attach to products via ProductModifierGroup."""

    class Selection(models.TextChoices):
        SINGLE = "SINGLE", "Choose one"
        MULTIPLE = "MULTIPLE", "Choose several"

    name = models.CharField(max_length=60, unique=True, help_text="Internal name, e.g. 'Milk (espresso drinks)'")
    display_name = models.CharField(max_length=60, help_text="Shown to customers, e.g. 'Milk'")
    selection_type = models.CharField(max_length=10, choices=Selection.choices, default=Selection.SINGLE)
    is_required = models.BooleanField(default=False)
    min_select = models.PositiveSmallIntegerField(default=0)
    max_select = models.PositiveSmallIntegerField(default=1)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            models.CheckConstraint(condition=Q(max_select__gte=F("min_select")), name="modgroup_max_gte_min"),
            models.CheckConstraint(condition=Q(max_select__gte=1), name="modgroup_max_at_least_one"),
        ]

    def __str__(self):
        return self.name


class ModifierOption(models.Model):
    group = models.ForeignKey(ModifierGroup, on_delete=models.CASCADE, related_name="options")
    name = models.CharField(max_length=60)
    price_delta = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0.00"))
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_available = models.BooleanField(default=True, help_text="Temporarily unavailable (e.g. out of oat milk)")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["group", "name"], name="modoption_unique_name_in_group"),
            models.CheckConstraint(
                condition=Q(price_delta__gte=-50) & Q(price_delta__lte=500), name="modoption_delta_sane"
            ),
        ]

    def __str__(self):
        return f"{self.group.name}: {self.name}"


class ProductModifierGroup(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="modifier_links")
    group = models.ForeignKey(ModifierGroup, on_delete=models.CASCADE, related_name="product_links")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["product", "group"], name="productmodgroup_unique")]


class Collection(models.Model):
    """Curated, manually ordered product lists (Bestsellers, New Arrivals, Seasonal Menu, Signature Drinks…)."""

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(unique=True)
    description = models.CharField(max_length=300, blank=True)
    image = models.ImageField(upload_to="collections/", blank=True)
    products = models.ManyToManyField(Product, through="CollectionItem", related_name="collections", blank=True)
    is_active = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class CollectionItem(models.Model):
    collection = models.ForeignKey(Collection, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="collection_items")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["collection", "product"], name="collectionitem_unique")]


class Favorite(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["user", "product"], name="favorite_unique")]


class Review(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending moderation"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="reviews")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reviews")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="reviews")
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    title = models.CharField(max_length=100, blank=True)
    body = models.TextField(max_length=2000, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    is_demo = models.BooleanField(
        default=False, help_text="Seeded demonstration review — not genuine customer feedback"
    )
    moderated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    moderated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["product", "user"], name="review_one_per_user_product"),
            models.CheckConstraint(condition=Q(rating__gte=1, rating__lte=5), name="review_rating_range"),
        ]
