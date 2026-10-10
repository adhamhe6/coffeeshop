"""Storefront branch serializers. Opening state is computed per request (never cached)."""

from __future__ import annotations

from datetime import timedelta

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.catalog.fields import ImageUrlField

from . import services
from .models import Branch, BranchDeliveryZone, DeliveryZone

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class BranchZoneSerializer(serializers.ModelSerializer):
    zone_id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(source="zone.name", read_only=True)
    slug = serializers.CharField(source="zone.slug", read_only=True)

    class Meta:
        model = BranchDeliveryZone
        fields = ["zone_id", "name", "slug", "fee", "min_order_total", "free_delivery_over", "eta_minutes"]


class HoursEntrySerializer(serializers.Serializer):
    weekday = serializers.IntegerField(help_text="0 = Monday … 6 = Sunday")
    label = serializers.CharField()
    text = serializers.CharField()
    opens = serializers.TimeField(allow_null=True)
    closes = serializers.TimeField(allow_null=True)
    is_closed = serializers.BooleanField()


class TodayHoursSerializer(serializers.Serializer):
    text = serializers.CharField()
    opens = serializers.TimeField(allow_null=True)
    closes = serializers.TimeField(allow_null=True)
    is_closed = serializers.BooleanField()


class BranchSerializer(serializers.ModelSerializer):
    image = ImageUrlField()
    is_open_now = serializers.SerializerMethodField()
    today_hours = serializers.SerializerMethodField()
    hours = serializers.SerializerMethodField()
    next_open_at = serializers.SerializerMethodField()
    delivery_zones = serializers.SerializerMethodField()

    class Meta:
        model = Branch
        fields = [
            "id",
            "slug",
            "code",
            "name",
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
            "is_placeholder_address",
            "pickup_enabled",
            "delivery_enabled",
            "accepting_orders",
            "prep_minutes",
            "is_open_now",
            "today_hours",
            "hours",
            "next_open_at",
            "delivery_zones",
        ]

    def _now(self):
        return self.context["now"]

    def get_is_open_now(self, obj) -> bool:
        return services.is_open_now(obj, self._now())

    @extend_schema_field(TodayHoursSerializer)
    def get_today_hours(self, obj):
        today = self._now().astimezone(obj.tz).date()
        window = services.opening_window(obj, today)  # honours closures
        if window is None:
            return {"text": "Closed today", "opens": None, "closes": None, "is_closed": True}
        hours = services.hours_for_day(obj, today)
        return {
            "text": services.format_hours(hours),
            "opens": hours.opens.strftime("%H:%M:%S"),
            "closes": hours.closes.strftime("%H:%M:%S"),
            "is_closed": False,
        }

    @extend_schema_field(HoursEntrySerializer(many=True))
    def get_hours(self, obj):
        by_day = {h.weekday: h for h in obj.hours.all()}
        out = []
        for weekday in range(7):
            h = by_day.get(weekday)
            closed = h is None or h.is_closed or not h.opens or not h.closes
            out.append(
                {
                    "weekday": weekday,
                    "label": WEEKDAYS[weekday],
                    "text": services.format_hours(h),
                    "opens": None if closed else h.opens.strftime("%H:%M:%S"),
                    "closes": None if closed else h.closes.strftime("%H:%M:%S"),
                    "is_closed": closed,
                }
            )
        return out

    def get_next_open_at(self, obj) -> str | None:
        moment = services.next_open_at(obj, self._now())
        return serializers.DateTimeField().to_representation(moment) if moment else None

    @extend_schema_field(BranchZoneSerializer(many=True))
    def get_delivery_zones(self, obj):
        if not obj.delivery_enabled:
            return []
        links = [link for link in obj.delivery_zones.all() if link.is_active and link.zone.is_active]
        links.sort(key=lambda link: link.zone.name)
        return BranchZoneSerializer(links, many=True).data


class SlotSerializer(serializers.Serializer):
    starts_at = serializers.DateTimeField()
    label = serializers.CharField()


class SlotsResponseSerializer(serializers.Serializer):
    date = serializers.DateField()
    timezone = serializers.CharField()
    asap_available = serializers.BooleanField()
    asap_eta = serializers.DateTimeField(allow_null=True)
    unavailable_code = serializers.CharField(allow_null=True)
    unavailable_message = serializers.CharField(allow_null=True)
    slots = SlotSerializer(many=True)


class DeliveryZonePublicSerializer(serializers.ModelSerializer):
    branch_slugs = serializers.SerializerMethodField()

    class Meta:
        model = DeliveryZone
        fields = ["id", "slug", "name", "branch_slugs"]

    def get_branch_slugs(self, obj) -> list[str]:
        return sorted(link.branch.slug for link in obj.branch_links.all())


def horizon_closure_cutoff(now):
    """Closures that ended more than a day ago can never matter."""
    return (now - timedelta(days=1)).date()
