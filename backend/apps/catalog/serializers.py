"""Storefront (public) serializers. Card/detail payloads are cacheable: they never contain per-user or per-branch data."""

from __future__ import annotations

import json

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.renderers import JSONRenderer

from .fields import ImageUrlField
from .models import Category, Collection, ModifierGroup, ModifierOption, Product, ProductImage, Review, Tag


def plain(data):
    """Round-trip through JSON so the value is cache-safe (no ReturnDict/Decimal/datetime objects)."""
    return json.loads(JSONRenderer().render(data))


class CategoryRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["slug", "name"]


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["slug", "name"]


class ProductFlagsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ["is_featured", "is_bestseller", "is_seasonal", "is_new"]


class CategorySerializer(serializers.ModelSerializer):
    image = ImageUrlField()
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Category
        fields = ["id", "slug", "name", "description", "image", "is_featured", "sort_order", "product_count"]


class ProductCardSerializer(serializers.ModelSerializer):
    category = CategoryRefSerializer(read_only=True)
    image = ImageUrlField()
    flags = ProductFlagsSerializer(source="*", read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    rating_avg = serializers.SerializerMethodField()
    rating_count = serializers.IntegerField(read_only=True)
    has_options = serializers.BooleanField(read_only=True)
    is_available = serializers.SerializerMethodField()
    unavailable_reason = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "slug",
            "name",
            "short_description",
            "base_price",
            "image",
            "category",
            "flags",
            "product_type",
            "stock_mode",
            "allergens",
            "tags",
            "rating_avg",
            "rating_count",
            "has_options",
            "is_available",
            "unavailable_reason",
        ]

    @extend_schema_field({"type": "number", "format": "float", "nullable": True})
    def get_rating_avg(self, obj) -> float | None:
        value = getattr(obj, "rating_avg", None)
        return round(value, 1) if value is not None else None

    def get_is_available(self, obj) -> bool:
        """Global flags only; send `?branch=` to the list/detail endpoints for branch-aware availability."""
        return not obj.is_sold_out

    @extend_schema_field(
        {
            "type": "string",
            "nullable": True,
            "enum": ["inactive", "sold_out", "branch_unavailable", "out_of_stock"],
        }
    )
    def get_unavailable_reason(self, obj) -> str | None:
        return "sold_out" if obj.is_sold_out else None


class ProductSuggestSerializer(serializers.ModelSerializer):
    image = ImageUrlField()
    category = CategoryRefSerializer(read_only=True)

    class Meta:
        model = Product
        fields = ["slug", "name", "image", "category", "base_price"]


class GalleryImageSerializer(serializers.ModelSerializer):
    url = ImageUrlField(source="image")

    class Meta:
        model = ProductImage
        fields = ["id", "url", "alt_text"]


class ModifierOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModifierOption
        fields = ["id", "name", "price_delta", "is_default", "is_available"]


class ModifierGroupSerializer(serializers.ModelSerializer):
    options = ModifierOptionSerializer(many=True, read_only=True)

    class Meta:
        model = ModifierGroup
        fields = ["id", "display_name", "selection_type", "is_required", "min_select", "max_select", "options"]


class RatingBucketSerializer(serializers.Serializer):
    rating = serializers.IntegerField()
    count = serializers.IntegerField()


class ReviewSummarySerializer(serializers.Serializer):
    average = serializers.FloatField(allow_null=True)
    count = serializers.IntegerField()
    distribution = RatingBucketSerializer(many=True)


class ProductDetailSerializer(ProductCardSerializer):
    gallery = GalleryImageSerializer(many=True, read_only=True)
    modifier_groups = serializers.SerializerMethodField()
    reviews = serializers.SerializerMethodField()
    related = serializers.SerializerMethodField()

    class Meta(ProductCardSerializer.Meta):
        fields = ProductCardSerializer.Meta.fields + [
            "description",
            "gallery",
            "nutrition",
            "calories",
            "caffeine_mg",
            "prep_minutes",
            "modifier_groups",
            "reviews",
            "related",
        ]

    @extend_schema_field(ModifierGroupSerializer(many=True))
    def get_modifier_groups(self, obj):
        return ModifierGroupSerializer(self.context["modifier_groups"], many=True).data

    @extend_schema_field(ReviewSummarySerializer)
    def get_reviews(self, obj):
        return self.context["review_summary"]

    @extend_schema_field(ProductCardSerializer(many=True))
    def get_related(self, obj):
        return ProductCardSerializer(self.context["related"], many=True).data


class CollectionSerializer(serializers.ModelSerializer):
    image = ImageUrlField()
    product_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Collection
        fields = ["id", "slug", "name", "description", "image", "is_featured", "sort_order", "product_count"]


class CollectionDetailSerializer(CollectionSerializer):
    products = serializers.SerializerMethodField()

    class Meta(CollectionSerializer.Meta):
        fields = CollectionSerializer.Meta.fields + ["products"]

    @extend_schema_field(ProductCardSerializer(many=True))
    def get_products(self, obj):
        return ProductCardSerializer(self.context["products"], many=True).data


# ── facets ───────────────────────────────────────────────────────────────────────────────────────────────────────────


class FacetCategorySerializer(serializers.Serializer):
    slug = serializers.CharField()
    name = serializers.CharField()
    count = serializers.IntegerField()


class FacetTypeSerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()
    count = serializers.IntegerField()


class FacetPriceSerializer(serializers.Serializer):
    min = serializers.DecimalField(max_digits=8, decimal_places=2, allow_null=True)
    max = serializers.DecimalField(max_digits=8, decimal_places=2, allow_null=True)


class FacetsSerializer(serializers.Serializer):
    categories = FacetCategorySerializer(many=True)
    tags = FacetCategorySerializer(many=True)
    types = FacetTypeSerializer(many=True)
    price = FacetPriceSerializer()


# ── reviews / favorites ──────────────────────────────────────────────────────────────────────────────────────────────


def reviewer_label(user) -> str:
    """First name + last initial ('Alex M.'); never the email or full surname."""
    first = (user.first_name or "").strip()
    last = (user.last_name or "").strip()
    if not first:
        return "Customer"
    return f"{first} {last[0].upper()}." if last else first


class ReviewSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField()
    verified_purchase = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = ["id", "rating", "title", "body", "author", "verified_purchase", "is_demo", "created_at"]

    def get_author(self, obj) -> str:
        return reviewer_label(obj.user)

    def get_verified_purchase(self, obj) -> bool:
        return obj.order_id is not None


class ReviewCreateSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5)
    title = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    body = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="", trim_whitespace=True)


class OwnReviewSerializer(ReviewSerializer):
    class Meta(ReviewSerializer.Meta):
        fields = ReviewSerializer.Meta.fields + ["status"]


class ReviewEligibilitySerializer(serializers.Serializer):
    can_review = serializers.BooleanField()
    reason = serializers.ChoiceField(
        choices=["login_required", "reviews_disabled", "not_purchased", "already_reviewed"], allow_null=True
    )


class FavoriteAddSerializer(serializers.Serializer):
    product_id = serializers.IntegerField(min_value=1)


class FavoriteMergeSerializer(serializers.Serializer):
    product_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=True, max_length=500)


class FavoriteIdsSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField())


class FavoriteMergeResultSerializer(serializers.Serializer):
    added = serializers.IntegerField()
    ids = serializers.ListField(child=serializers.IntegerField())
