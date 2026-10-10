"""Staff (admin) serializers for the catalogue: products, categories, modifiers, collections, tags, reviews."""

from __future__ import annotations

import re

from django.db import transaction
from django.utils.text import slugify
from rest_framework import serializers

from .fields import ImageUrlField
from .models import (
    Category,
    Collection,
    CollectionItem,
    ModifierGroup,
    ModifierOption,
    Product,
    ProductImage,
    ProductModifierGroup,
    Review,
    Tag,
)
from .services import unique_slug

ALLERGEN_RE = re.compile(r"^[a-z][a-z \-]{0,29}$")
NUTRITION_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


def assert_unique(model, field: str, value, instance=None, message: str = "This value is already in use."):
    qs = model.objects.filter(**{field: value})
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise serializers.ValidationError(message)
    return value


# ── products ─────────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminProductListSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    image = ImageUrlField()
    stock_total = serializers.IntegerField(read_only=True, allow_null=True)
    low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "slug",
            "sku",
            "name",
            "category",
            "category_name",
            "product_type",
            "stock_mode",
            "base_price",
            "image",
            "is_active",
            "is_featured",
            "is_bestseller",
            "is_seasonal",
            "is_new",
            "is_sold_out",
            "sort_order",
            "stock_total",
            "low_stock",
            "is_demo",
            "updated_at",
        ]


class AdminGallerySerializer(serializers.ModelSerializer):
    url = ImageUrlField(source="image")

    class Meta:
        model = ProductImage
        fields = ["id", "url", "alt_text", "sort_order"]
        read_only_fields = ["id", "url", "sort_order"]


class ModifierGroupRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModifierGroup
        fields = ["id", "name", "display_name", "is_active"]


class TagNamesField(serializers.ListField):
    """Tags are read and written as a list of names; unknown names are created on save."""

    child = serializers.CharField(max_length=40)

    def get_attribute(self, instance):
        return list(instance.tags.all())

    def to_representation(self, data):
        return [t.name for t in data]


class OrderedGroupIdsField(serializers.ListField):
    child = serializers.IntegerField(min_value=1)

    def get_attribute(self, instance):
        return [link.group_id for link in instance.modifier_links.all()]


class AdminProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    image = ImageUrlField()
    gallery = AdminGallerySerializer(many=True, read_only=True)
    tags = TagNamesField(required=False, max_length=30)
    allergens = serializers.ListField(child=serializers.CharField(max_length=30), required=False, max_length=20)
    modifier_group_ids = OrderedGroupIdsField(
        required=False, max_length=30, help_text="Ordered ids of the modifier groups attached to this product"
    )
    modifier_groups = serializers.SerializerMethodField()
    slug = serializers.SlugField(max_length=140, required=False, allow_blank=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "slug",
            "sku",
            "name",
            "category",
            "category_name",
            "product_type",
            "stock_mode",
            "short_description",
            "description",
            "base_price",
            "image",
            "gallery",
            "is_active",
            "is_featured",
            "is_bestseller",
            "is_seasonal",
            "is_new",
            "is_sold_out",
            "prep_minutes",
            "calories",
            "caffeine_mg",
            "allergens",
            "nutrition",
            "tags",
            "modifier_group_ids",
            "modifier_groups",
            "sort_order",
            "is_demo",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_demo", "created_at", "updated_at"]

    def get_modifier_groups(self, obj) -> list[dict]:
        return ModifierGroupRefSerializer([link.group for link in obj.modifier_links.all()], many=True).data

    # ── field validation ──
    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def validate_slug(self, value):
        value = value.strip().lower()
        return (
            assert_unique(Product, "slug", value, self.instance, "A product with this slug already exists.")
            if value
            else value
        )

    def validate_allergens(self, value):
        cleaned: list[str] = []
        for raw in value:
            item = re.sub(r"\s+", " ", raw.strip().lower())
            if not ALLERGEN_RE.match(item):
                raise serializers.ValidationError(f"'{raw}' is not a valid allergen name (letters, spaces, hyphens).")
            if item not in cleaned:
                cleaned.append(item)
        return cleaned

    def validate_tags(self, value):
        names: list[str] = []
        for raw in value:
            name = re.sub(r"\s+", " ", raw.strip())
            if not name or not slugify(name):
                raise serializers.ValidationError("Tag names must contain letters or digits.")
            if name.lower() not in {n.lower() for n in names}:
                names.append(name)
        return names

    def validate_nutrition(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Nutrition must be an object of name/value pairs.")
        if len(value) > 20:
            raise serializers.ValidationError("At most 20 nutrition entries.")
        for key, val in value.items():
            if not NUTRITION_KEY_RE.match(str(key)):
                raise serializers.ValidationError(f"Invalid nutrition key '{key}' (use lower_snake_case).")
            if isinstance(val, bool) or not (
                (isinstance(val, (int, float)) and 0 <= val <= 100000) or (isinstance(val, str) and len(val) <= 40)
            ):
                raise serializers.ValidationError(f"'{key}' must be a number between 0 and 100000 or a short text.")
        return value

    def validate_modifier_group_ids(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Each group can only be attached once.")
        found = set(ModifierGroup.objects.filter(pk__in=value).values_list("pk", flat=True))
        missing = [i for i in value if i not in found]
        if missing:
            raise serializers.ValidationError(f"Unknown modifier groups: {missing}.")
        return value

    # ── writes ──
    @transaction.atomic
    def create(self, validated_data):
        tags = validated_data.pop("tags", [])
        group_ids = validated_data.pop("modifier_group_ids", [])
        validated_data["slug"] = validated_data.get("slug") or unique_slug(
            Product, validated_data["name"], fallback="product"
        )
        product = Product.objects.create(**validated_data)
        self._set_tags(product, tags)
        self._set_groups(product, group_ids)
        return product

    @transaction.atomic
    def update(self, instance, validated_data):
        tags = validated_data.pop("tags", None)
        group_ids = validated_data.pop("modifier_group_ids", None)
        if "slug" in validated_data and not validated_data["slug"]:
            validated_data["slug"] = unique_slug(
                Product, validated_data.get("name", instance.name), exclude_pk=instance.pk
            )
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if tags is not None:
            self._set_tags(instance, tags)
        if group_ids is not None:
            self._set_groups(instance, group_ids)
        return instance

    @staticmethod
    def _set_tags(product, names):
        tags = []
        for name in names:
            slug = slugify(name)
            tag = Tag.objects.filter(name__iexact=name).first() or Tag.objects.filter(slug=slug).first()
            if tag is None:
                tag = Tag.objects.create(name=name, slug=unique_slug(Tag, name, fallback="tag"))
            tags.append(tag)
        product.tags.set(tags)

    @staticmethod
    def _set_groups(product, group_ids):
        existing = {link.group_id: link for link in ProductModifierGroup.objects.filter(product=product)}
        for position, gid in enumerate(group_ids):
            link = existing.pop(gid, None)
            if link is None:
                ProductModifierGroup.objects.create(product=product, group_id=gid, sort_order=position)
            elif link.sort_order != position:
                link.sort_order = position
                link.save(update_fields=["sort_order"])
        if existing:
            ProductModifierGroup.objects.filter(pk__in=[link.pk for link in existing.values()]).delete()


# ── categories ───────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminCategorySerializer(serializers.ModelSerializer):
    image = ImageUrlField()
    slug = serializers.SlugField(required=False, allow_blank=True)
    product_count = serializers.IntegerField(read_only=True)
    active_product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "image",
            "sort_order",
            "is_active",
            "is_featured",
            "product_count",
            "active_product_count",
        ]
        read_only_fields = ["id"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def validate_slug(self, value):
        return (
            assert_unique(Category, "slug", value, self.instance, "A category with this slug already exists.")
            if value
            else value
        )

    def create(self, validated_data):
        validated_data["slug"] = validated_data.get("slug") or unique_slug(
            Category, validated_data["name"], fallback="category"
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "slug" in validated_data and not validated_data["slug"]:
            validated_data["slug"] = unique_slug(
                Category, validated_data.get("name", instance.name), exclude_pk=instance.pk
            )
        return super().update(instance, validated_data)


# ── tags ─────────────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminTagSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True)
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Tag
        fields = ["id", "name", "slug", "product_count"]
        read_only_fields = ["id"]

    def validate_slug(self, value):
        return (
            assert_unique(Tag, "slug", value, self.instance, "A tag with this slug already exists.") if value else value
        )

    def create(self, validated_data):
        validated_data["slug"] = validated_data.get("slug") or unique_slug(Tag, validated_data["name"], fallback="tag")
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "slug" in validated_data and not validated_data["slug"]:
            validated_data["slug"] = unique_slug(Tag, validated_data.get("name", instance.name), exclude_pk=instance.pk)
        return super().update(instance, validated_data)


# ── modifiers ────────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminModifierOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModifierOption
        fields = ["id", "name", "price_delta", "is_default", "is_active", "is_available", "sort_order"]
        read_only_fields = ["id"]
        extra_kwargs = {"sort_order": {"required": False}}
        validators: list = []  # unique (group, name) is checked by the view with a clean field error

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def validate_price_delta(self, value):
        if value < -50 or value > 500:
            raise serializers.ValidationError("Price adjustment must be between -50.00 and 500.00.")
        return value


class AdminModifierGroupSerializer(serializers.ModelSerializer):
    options = AdminModifierOptionSerializer(many=True, required=False)
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = ModifierGroup
        fields = [
            "id",
            "name",
            "display_name",
            "selection_type",
            "is_required",
            "min_select",
            "max_select",
            "sort_order",
            "is_active",
            "product_count",
            "options",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {
            "min_select": {"required": False},
            "max_select": {"required": False},
            "sort_order": {"required": False},
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            # options are edited through the nested /options/ endpoints once the group exists
            self.fields["options"].read_only = True

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def validate(self, attrs):
        cur = self.instance
        selection = attrs.get("selection_type", cur.selection_type if cur else ModifierGroup.Selection.SINGLE)
        required = attrs.get("is_required", cur.is_required if cur else False)
        if "min_select" in attrs:
            min_select = attrs["min_select"]
        elif cur is None or "is_required" in attrs:
            min_select = 1 if required else 0
        else:
            min_select = cur.min_select
        errors: dict[str, str] = {}
        if selection == ModifierGroup.Selection.SINGLE:
            if attrs.get("max_select", 1) != 1:
                errors["max_select"] = "A choose-one group allows exactly one selection."
            max_select = 1
        elif "max_select" in attrs:
            max_select = attrs["max_select"]
        elif cur is not None and cur.selection_type == ModifierGroup.Selection.MULTIPLE:
            max_select = cur.max_select
        else:
            errors["max_select"] = "Set how many options a customer may choose."
            max_select = 1
        if max_select < 1:
            errors["max_select"] = "Must be at least 1."
        if min_select > max_select:
            errors["min_select"] = "Minimum cannot exceed the maximum."
        elif required and min_select < 1:
            errors["min_select"] = "A required group needs a minimum of at least 1."
        elif not required and min_select > 0:
            errors["min_select"] = "Only required groups can have a minimum above 0."
        if errors:
            raise serializers.ValidationError(errors)
        attrs["max_select"] = max_select
        attrs["min_select"] = min_select
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        options = validated_data.pop("options", [])
        group = ModifierGroup.objects.create(**validated_data)
        names = [o["name"].lower() for o in options]
        if len(set(names)) != len(names):
            raise serializers.ValidationError({"options": ["Option names must be unique within the group."]})
        for position, option in enumerate(options):
            option.setdefault("sort_order", position)
            ModifierOption.objects.create(group=group, **option)
        validate_defaults(group)
        return group


def validate_defaults(group: ModifierGroup) -> None:
    """At most `max_select` options may be pre-selected (default)."""
    defaults = group.options.filter(is_default=True, is_active=True).count()
    if defaults > group.max_select:
        raise serializers.ValidationError({"options": [f"At most {group.max_select} option(s) can be the default."]})


# ── collections ──────────────────────────────────────────────────────────────────────────────────────────────────────


class CollectionProductSerializer(serializers.ModelSerializer):
    image = ImageUrlField()

    class Meta:
        model = Product
        fields = ["id", "name", "slug", "image", "is_active", "base_price"]


class AdminCollectionSerializer(serializers.ModelSerializer):
    image = ImageUrlField()
    slug = serializers.SlugField(required=False, allow_blank=True)
    product_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, max_length=200, help_text="Ordered product ids"
    )
    products = serializers.SerializerMethodField()
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Collection
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "image",
            "is_active",
            "is_featured",
            "sort_order",
            "product_count",
            "product_ids",
            "products",
        ]
        read_only_fields = ["id"]

    def validate_slug(self, value):
        return (
            assert_unique(Collection, "slug", value, self.instance, "A collection with this slug already exists.")
            if value
            else value
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["product_ids"] = [item.product_id for item in instance.items.all()]
        return data

    def get_products(self, obj) -> list[dict]:
        return CollectionProductSerializer([item.product for item in obj.items.all()], many=True).data

    def validate_product_ids(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError("A product can only appear once.")
        found = set(Product.objects.filter(pk__in=value).values_list("pk", flat=True))
        missing = [i for i in value if i not in found]
        if missing:
            raise serializers.ValidationError(f"Unknown products: {missing}.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        product_ids = validated_data.pop("product_ids", [])
        validated_data["slug"] = validated_data.get("slug") or unique_slug(
            Collection, validated_data["name"], fallback="collection"
        )
        collection = Collection.objects.create(**validated_data)
        set_collection_products(collection, product_ids)
        return collection

    @transaction.atomic
    def update(self, instance, validated_data):
        product_ids = validated_data.pop("product_ids", None)
        if "slug" in validated_data and not validated_data["slug"]:
            validated_data["slug"] = unique_slug(
                Collection, validated_data.get("name", instance.name), exclude_pk=instance.pk
            )
        instance = super().update(instance, validated_data)
        if product_ids is not None:
            set_collection_products(instance, product_ids)
        return instance


def set_collection_products(collection: Collection, product_ids: list[int]) -> None:
    """Replace membership and order (position in the list = sort_order)."""
    existing = {item.product_id: item for item in CollectionItem.objects.filter(collection=collection)}
    for position, pid in enumerate(product_ids):
        item = existing.pop(pid, None)
        if item is None:
            CollectionItem.objects.create(collection=collection, product_id=pid, sort_order=position)
        elif item.sort_order != position:
            item.sort_order = position
            item.save(update_fields=["sort_order"])
    if existing:
        CollectionItem.objects.filter(pk__in=[i.pk for i in existing.values()]).delete()


class CollectionProductIdsSerializer(serializers.Serializer):
    product_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=200)


class CollectionAddProductSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)


# ── reviews ──────────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminReviewSerializer(serializers.ModelSerializer):
    product = serializers.SerializerMethodField()
    customer = serializers.SerializerMethodField()
    order_number = serializers.CharField(source="order.number", read_only=True, default=None)
    moderated_by = serializers.EmailField(source="moderated_by.email", read_only=True, default=None)

    class Meta:
        model = Review
        fields = [
            "id",
            "product",
            "customer",
            "order_number",
            "rating",
            "title",
            "body",
            "status",
            "is_demo",
            "moderated_by",
            "moderated_at",
            "created_at",
        ]

    def get_product(self, obj) -> dict:
        return {"id": obj.product_id, "name": obj.product.name, "slug": obj.product.slug}

    def get_customer(self, obj) -> dict:
        return {"id": obj.user_id, "name": obj.user.full_name, "email": obj.user.email}
