import re
from decimal import Decimal

from django.db.models import Q
from rest_framework import serializers

from apps.catalog.models import Category, Product
from apps.orders.models import Order

from .models import Coupon

CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,39}$")
MONEY = {"max_digits": 10, "decimal_places": 2}


class CouponValidateRequestSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=40)
    order_type = serializers.ChoiceField(choices=Order.Type.choices, required=False)
    branch_id = serializers.IntegerField(required=False, allow_null=True)


class CouponValidationSerializer(serializers.Serializer):
    valid = serializers.BooleanField()
    code = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    discount_type = serializers.ChoiceField(choices=Coupon.DiscountType.choices)
    value = serializers.DecimalField(max_digits=8, decimal_places=2)
    discount = serializers.DecimalField(**MONEY, help_text="What this code takes off the current cart")
    subtotal = serializers.DecimalField(**MONEY)
    min_order_total = serializers.DecimalField(**MONEY)
    max_discount = serializers.DecimalField(**MONEY, allow_null=True)


class AdminCouponSerializer(serializers.ModelSerializer):
    code = serializers.CharField(max_length=40, required=False, allow_blank=True)
    category_ids = serializers.PrimaryKeyRelatedField(
        source="categories", many=True, queryset=Category.objects.all(), required=False
    )
    product_ids = serializers.PrimaryKeyRelatedField(
        source="products", many=True, queryset=Product.objects.all(), required=False
    )
    total_discount = serializers.DecimalField(
        **MONEY, read_only=True, help_text="Sum of discounts from non-voided redemptions"
    )
    redemption_count = serializers.IntegerField(read_only=True, help_text="Non-voided redemptions")
    created_by_email = serializers.SerializerMethodField()

    class Meta:
        model = Coupon
        fields = [
            "id",
            "code",
            "name",
            "description",
            "discount_type",
            "value",
            "max_discount",
            "min_order_total",
            "applies_to",
            "category_ids",
            "product_ids",
            "first_order_only",
            "is_automatic",
            "starts_at",
            "ends_at",
            "usage_limit",
            "per_customer_limit",
            "times_redeemed",
            "total_discount",
            "redemption_count",
            "is_active",
            "created_by_email",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "times_redeemed", "created_at", "updated_at"]

    def get_created_by_email(self, obj) -> str | None:
        return obj.created_by.email if obj.created_by_id else None

    def validate_code(self, value):
        value = (value or "").strip().upper()
        if value and not CODE_RE.match(value):
            raise serializers.ValidationError("Use 3-40 letters, digits, '-' or '_' (starting with a letter or digit).")
        return value

    def validate(self, attrs):
        inst = self.instance

        def get(name, default=None):
            return attrs.get(name, getattr(inst, name, default) if inst else default)

        code = attrs.get("code", inst.code if inst else "")
        if not code:
            if get("is_automatic"):
                import secrets

                attrs["code"] = f"AUTO-{secrets.token_hex(4).upper()}"
            else:
                raise serializers.ValidationError({"code": ["A code is required for coupons customers type in."]})
        else:
            clash = Coupon.objects.filter(code__iexact=code)
            if inst:
                clash = clash.exclude(pk=inst.pk)
            if clash.exists():
                raise serializers.ValidationError({"code": ["A coupon with this code already exists."]})

        value = Decimal(get("value", Decimal("0")))
        if get("discount_type") == Coupon.DiscountType.PERCENT:
            if not (Decimal("0") < value <= Decimal("100")):
                raise serializers.ValidationError({"value": ["A percentage must be between 0.01 and 100."]})
        elif value <= 0:
            raise serializers.ValidationError({"value": ["The amount must be greater than zero."]})

        starts, ends = get("starts_at"), get("ends_at")
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": ["The end must be after the start."]})
        for field in ("usage_limit", "per_customer_limit"):
            limit = get(field)
            if limit is not None and limit < 1:
                raise serializers.ValidationError({field: ["Must be at least 1, or leave empty for no limit."]})
        if inst and get("usage_limit") is not None and get("usage_limit") < inst.times_redeemed:
            raise serializers.ValidationError(
                {"usage_limit": [f"{inst.times_redeemed} redemptions already used; the limit cannot be lower."]}
            )

        applies = get("applies_to")
        categories = attrs["categories"] if "categories" in attrs else (list(inst.categories.all()) if inst else [])
        products = attrs["products"] if "products" in attrs else (list(inst.products.all()) if inst else [])
        if applies == Coupon.AppliesTo.CATEGORIES and not categories:
            raise serializers.ValidationError({"category_ids": ["Choose at least one category."]})
        if applies == Coupon.AppliesTo.PRODUCTS and not products:
            raise serializers.ValidationError({"product_ids": ["Choose at least one product."]})
        if applies == Coupon.AppliesTo.ALL:
            attrs["categories"], attrs["products"] = [], []
        elif applies == Coupon.AppliesTo.CATEGORIES:
            attrs["products"] = []
        else:
            attrs["categories"] = []
        return attrs


def annotate_stats(queryset):
    from django.db.models import Count, DecimalField, Sum, Value
    from django.db.models.functions import Coalesce

    live = Q(redemptions__is_voided=False)
    return (
        queryset.select_related("created_by")
        .prefetch_related("categories", "products")
        .annotate(
            total_discount=Coalesce(
                Sum("redemptions__discount_amount", filter=live), Value(Decimal("0.00")), output_field=DecimalField()
            ),
            redemption_count=Count("redemptions", filter=live),
        )
    )
