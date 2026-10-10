"""Public branch API: locations, opening state, bookable slots, delivery zones."""

from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.serializers import plain
from apps.core.cache import cached
from apps.core.errors import DomainError

from . import services
from .models import Branch, BranchClosure, BranchDeliveryZone, DeliveryZone
from .serializers import (
    BranchSerializer,
    DeliveryZonePublicSerializer,
    SlotsResponseSerializer,
    horizon_closure_cutoff,
)

BLOCKING = {"ordering_paused", "pickup_unavailable", "delivery_unavailable"}


def public_branches():
    now = timezone.now()
    return (
        Branch.objects.filter(is_active=True)
        .prefetch_related(
            "hours",
            Prefetch("closures", queryset=BranchClosure.objects.filter(end_date__gte=horizon_closure_cutoff(now))),
            Prefetch(
                "delivery_zones",
                queryset=BranchDeliveryZone.objects.filter(is_active=True, zone__is_active=True).select_related("zone"),
            ),
        )
        .order_by("sort_order", "name")
    )


class BranchListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = BranchSerializer
    pagination_class = None
    filter_backends: list = []

    def get_queryset(self):
        return public_branches()

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "now": timezone.now()}


class BranchDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = BranchSerializer
    lookup_field = "slug"
    filter_backends: list = []

    def get_queryset(self):
        return public_branches()

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "now": timezone.now()}


class BranchSlotsView(APIView):
    """ASAP availability and 15-minute scheduled slots (aware datetimes) for one order type on one local date."""

    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("type", str, enum=["PICKUP", "DELIVERY"], description="Order type (default PICKUP)"),
            OpenApiParameter(
                "date", date, description="Branch-local date, YYYY-MM-DD (default today, max 7 days ahead)"
            ),
        ],
        responses=SlotsResponseSerializer,
    )
    def get(self, request, slug):
        branch = get_object_or_404(public_branches(), slug=slug)
        order_type = (request.query_params.get("type") or services.PICKUP).upper()
        if order_type not in services.ORDER_TYPES:
            raise ValidationError({"type": ["Choose PICKUP or DELIVERY."]})
        now = timezone.now()
        today = now.astimezone(branch.tz).date()
        raw_date = request.query_params.get("date")
        try:
            day = date.fromisoformat(raw_date) if raw_date else today
        except ValueError:
            raise ValidationError({"date": ["Use the format YYYY-MM-DD."]})

        code = message = None
        blocked = False  # nothing can be scheduled at all (as opposed to "closed right now")
        try:
            services.assert_branch_accepts(branch, order_type, now=now)
        except DomainError as exc:
            code, message = exc.detail.code, str(exc.detail)
            blocked = code in BLOCKING or (code == "branch_closed" and exc.extra.get("reason") != "closed_now")
        asap = code is None
        slots = (
            []
            if blocked or not (today <= day <= today + timedelta(days=services.MAX_DAYS_AHEAD))
            else (services.available_slots(branch, order_type, day, now=now))
        )
        return Response(
            {
                "date": day,
                "timezone": branch.timezone,
                "asap_available": asap,
                "asap_eta": services.asap_eta(branch, now) if asap else None,
                "unavailable_code": code,
                "unavailable_message": message,
                "slots": [{"starts_at": s, "label": services.format_slot_label(s, branch)} for s in slots],
            }
        )


class DeliveryZoneListView(generics.ListAPIView):
    """Active delivery zones (for the address form) with the branches that serve them."""

    permission_classes = [AllowAny]
    serializer_class = DeliveryZonePublicSerializer
    pagination_class = None
    filter_backends: list = []

    def list(self, request, *args, **kwargs):
        def build():
            qs = DeliveryZone.objects.filter(is_active=True).prefetch_related(
                Prefetch(
                    "branch_links",
                    queryset=BranchDeliveryZone.objects.filter(is_active=True, branch__is_active=True).select_related(
                        "branch"
                    ),
                )
            )
            return plain(DeliveryZonePublicSerializer(qs, many=True).data)

        return Response(cached("catalog", ("delivery-zones",), build))
