from __future__ import annotations

from rest_framework import serializers

from apps.accounts.models import User
from apps.branches.models import Branch
from apps.catalog.fields import ImageUrlField
from apps.catalog.models import Product

from .models import InventoryMovement, StockItem
from .services import MANUAL_TYPES


class StockBranchRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "name", "code"]


class StockProductRefSerializer(serializers.ModelSerializer):
    image = ImageUrlField()

    class Meta:
        model = Product
        fields = ["id", "name", "sku", "slug", "image"]


class StockItemSerializer(serializers.ModelSerializer):
    branch = StockBranchRefSerializer(read_only=True)
    product = StockProductRefSerializer(read_only=True)
    is_low = serializers.SerializerMethodField()
    stock_value = serializers.SerializerMethodField()

    class Meta:
        model = StockItem
        fields = [
            "id",
            "branch",
            "product",
            "quantity",
            "low_stock_threshold",
            "is_low",
            "unit_cost",
            "stock_value",
            "updated_at",
        ]
        read_only_fields = ["id", "quantity", "updated_at"]

    def get_is_low(self, obj) -> bool:
        return obj.is_low

    def get_stock_value(self, obj) -> str | None:
        value = getattr(obj, "stock_value", None)
        if value is None and obj.unit_cost is not None:
            value = obj.quantity * obj.unit_cost
        return None if value is None else f"{value:.2f}"


class StockItemUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockItem
        fields = ["low_stock_threshold", "unit_cost"]
        extra_kwargs = {"low_stock_threshold": {"max_value": 100000}, "unit_cost": {"min_value": 0}}

    def validate(self, attrs):
        if "quantity" in getattr(self, "initial_data", {}):
            raise serializers.ValidationError({"quantity": "Quantity can only be changed with a stock adjustment."})
        return attrs


class AdjustStockSerializer(serializers.Serializer):
    branch = serializers.IntegerField(min_value=1)
    product = serializers.IntegerField(min_value=1)
    delta = serializers.IntegerField(required=False, min_value=-1_000_000, max_value=1_000_000)
    set_to = serializers.IntegerField(required=False, min_value=0, max_value=1_000_000)
    movement_type = serializers.ChoiceField(choices=sorted(t.value for t in MANUAL_TYPES))
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if ("delta" in attrs) == ("set_to" in attrs):
            raise serializers.ValidationError({"delta": "Provide exactly one of delta or set_to."})
        if attrs["movement_type"] in ("ADJUSTMENT", "WASTE") and not attrs["reason"].strip():
            raise serializers.ValidationError({"reason": "A reason is required for adjustments and waste."})
        return attrs


class ActorSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="full_name")

    class Meta:
        model = User
        fields = ["id", "email", "name"]


class MovementSerializer(serializers.ModelSerializer):
    branch = StockBranchRefSerializer(source="stock_item.branch", read_only=True)
    product = StockProductRefSerializer(source="stock_item.product", read_only=True)
    actor = ActorSerializer(read_only=True, allow_null=True)

    class Meta:
        model = InventoryMovement
        fields = [
            "id",
            "branch",
            "product",
            "movement_type",
            "quantity_delta",
            "quantity_after",
            "reference",
            "reason",
            "actor",
            "created_at",
        ]


class AdjustResultSerializer(serializers.Serializer):
    stock_item = StockItemSerializer()
    movement = MovementSerializer()


class AvailabilityRowSerializer(serializers.Serializer):
    product = StockProductRefSerializer()
    category_name = serializers.CharField()
    is_available = serializers.BooleanField(help_text="Branch toggle (absent row = available)")
    is_sold_out = serializers.BooleanField(help_text="Global sold-out flag on the product")
    updated_at = serializers.DateTimeField(allow_null=True)


class AvailabilityUpdateSerializer(serializers.Serializer):
    branch = serializers.IntegerField(min_value=1)
    product = serializers.IntegerField(min_value=1)
    is_available = serializers.BooleanField()


class UnavailableEntrySerializer(serializers.Serializer):
    branch = StockBranchRefSerializer(allow_null=True)
    product = StockProductRefSerializer()
    reason = serializers.ChoiceField(choices=["branch_unavailable", "out_of_stock", "sold_out"])
    since = serializers.DateTimeField(allow_null=True)


class InventorySummarySerializer(serializers.Serializer):
    tracked_items = serializers.IntegerField()
    low_stock_count = serializers.IntegerField(help_text="Items at or below their threshold (includes out of stock)")
    out_of_stock_count = serializers.IntegerField()
    valuation = serializers.DecimalField(max_digits=14, decimal_places=2, help_text="Sum of quantity x unit cost")
    unvalued_items = serializers.IntegerField(help_text="In-stock items with no unit cost (excluded from valuation)")
    unavailable = UnavailableEntrySerializer(many=True)
