"""Staff serializers for branches, opening hours, closures, delivery zones."""

from __future__ import annotations

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from apps.accounts.models import StaffProfile
from apps.catalog.fields import ImageUrlField
from apps.catalog.services import unique_slug

from .models import Branch, BranchClosure, BranchDeliveryZone, BranchHours, DeliveryZone


class AdminBranchSerializer(serializers.ModelSerializer):
    image = ImageUrlField()
    slug = serializers.SlugField(required=False, allow_blank=True)
    code = serializers.SlugField(max_length=12)
    latitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, required=False, allow_null=True, min_value=-90, max_value=90
    )
    longitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, required=False, allow_null=True, min_value=-180, max_value=180
    )
    prep_minutes = serializers.IntegerField(min_value=0, max_value=240, required=False)
    is_open_now = serializers.SerializerMethodField()

    class Meta:
        model = Branch
        fields = [
            "id",
            "code",
            "name",
            "slug",
            "description",
            "image",
            "address_line",
            "city",
            "postal_code",
            "latitude",
            "longitude",
            "phone",
            "email",
            "timezone",
            "is_active",
            "is_placeholder_address",
            "pickup_enabled",
            "delivery_enabled",
            "accepting_orders",
            "prep_minutes",
            "sort_order",
            "is_open_now",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_is_open_now(self, obj) -> bool:
        from . import services

        return services.is_open_now(obj)

    def validate_code(self, value):
        value = value.strip().upper()
        clash = Branch.objects.filter(code__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A branch with this code already exists.")
        return value

    def validate_slug(self, value):
        value = value.strip().lower()
        clash = Branch.objects.filter(slug=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if value and clash.exists():
            raise serializers.ValidationError("A branch with this slug already exists.")
        return value

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            raise serializers.ValidationError("Unknown time zone. Use an IANA name such as 'Europe/Berlin'.")
        return value

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def create(self, validated_data):
        validated_data["slug"] = validated_data.get("slug") or unique_slug(
            Branch, validated_data["name"], fallback="branch"
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "slug" in validated_data and not validated_data["slug"]:
            validated_data["slug"] = unique_slug(
                Branch, validated_data.get("name", instance.name), exclude_pk=instance.pk
            )
        return super().update(instance, validated_data)


class BranchOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "code", "name", "slug", "is_active"]


class HoursEntrySerializer(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    is_closed = serializers.BooleanField(default=False)
    opens = serializers.TimeField(required=False, allow_null=True)
    closes = serializers.TimeField(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs["is_closed"]:
            attrs["opens"] = attrs["closes"] = None
            return attrs
        opens, closes = attrs.get("opens"), attrs.get("closes")
        if opens is None or closes is None:
            raise serializers.ValidationError("Opening and closing times are required unless the day is closed.")
        if closes <= opens:
            raise serializers.ValidationError({"closes": "Closing time must be after opening time."})
        return attrs


class BranchHoursSerializer(serializers.ModelSerializer):
    class Meta:
        model = BranchHours
        fields = ["weekday", "is_closed", "opens", "closes"]


class BranchHoursWriteSerializer(serializers.Serializer):
    hours = HoursEntrySerializer(many=True, max_length=7)

    def validate_hours(self, value):
        days = [h["weekday"] for h in value]
        if len(set(days)) != len(days):
            raise serializers.ValidationError("Each weekday may appear only once.")
        return value


class BranchClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = BranchClosure
        fields = ["id", "start_date", "end_date", "reason"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "The end date cannot be before the start date."})
        return attrs


class BranchZoneLinkSerializer(serializers.ModelSerializer):
    zone = serializers.PrimaryKeyRelatedField(queryset=DeliveryZone.objects.all())
    zone_name = serializers.CharField(source="zone.name", read_only=True)
    zone_is_active = serializers.BooleanField(source="zone.is_active", read_only=True)
    eta_minutes = serializers.IntegerField(min_value=1, max_value=240, required=False)

    class Meta:
        model = BranchDeliveryZone
        fields = [
            "id",
            "zone",
            "zone_name",
            "zone_is_active",
            "fee",
            "min_order_total",
            "free_delivery_over",
            "eta_minutes",
            "is_active",
        ]
        read_only_fields = ["id"]
        validators: list = []

    def validate_zone(self, value):
        if self.instance is not None and value.pk != self.instance.zone_id:
            raise serializers.ValidationError("A link cannot be moved to another zone; remove it and add a new one.")
        return value

    def validate(self, attrs):
        for field in ("fee", "min_order_total", "free_delivery_over"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Cannot be negative."})
        return attrs


class AdminDeliveryZoneSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(required=False, allow_blank=True)
    branch_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = DeliveryZone
        fields = ["id", "name", "slug", "is_active", "branch_count"]
        read_only_fields = ["id"]

    def validate_name(self, value):
        value = value.strip()
        clash = DeliveryZone.objects.filter(name__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        if clash.exists():
            raise serializers.ValidationError("A zone with this name already exists.")
        return value

    def validate_slug(self, value):
        clash = DeliveryZone.objects.filter(slug=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if value and clash.exists():
            raise serializers.ValidationError("A zone with this slug already exists.")
        return value

    def create(self, validated_data):
        validated_data["slug"] = validated_data.get("slug") or unique_slug(
            DeliveryZone, validated_data["name"], fallback="zone"
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "slug" in validated_data and not validated_data["slug"]:
            validated_data["slug"] = unique_slug(
                DeliveryZone, validated_data.get("name", instance.name), exclude_pk=instance.pk
            )
        return super().update(instance, validated_data)


class BranchStaffSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user_id")
    email = serializers.EmailField(source="user.email")
    name = serializers.CharField(source="user.full_name")

    class Meta:
        model = StaffProfile
        fields = ["id", "email", "name", "role", "job_title"]
