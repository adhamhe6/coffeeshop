"""Staff API for branches. Every read/write is limited to the staff member's branch scope (out of scope = 404)."""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import filters, generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response

from apps.accounts.models import StaffProfile
from apps.accounts.permissions import HasCapability, IsStaff, branch_scope
from apps.catalog.admin_views import ImageActionsMixin, StaffModelViewSet
from apps.catalog.staff import diff, snapshot
from apps.core.audit import audit
from apps.core.cache import bump
from apps.core.errors import DomainError

from .admin_serializers import (
    AdminBranchSerializer,
    AdminDeliveryZoneSerializer,
    BranchClosureSerializer,
    BranchHoursSerializer,
    BranchHoursWriteSerializer,
    BranchOptionSerializer,
    BranchStaffSerializer,
    BranchZoneLinkSerializer,
)
from .models import Branch, BranchDeliveryZone, BranchHours, DeliveryZone

log = logging.getLogger(__name__)

GLOBAL_ONLY_FIELDS = {"code", "slug", "is_active", "sort_order"}


class GlobalScopeRequired(BasePermission):
    """Allows the request only for staff whose branch scope is 'all branches' (admins)."""

    message = "Only administrators with access to every branch can do this."

    def has_permission(self, request, view):
        return branch_scope(request.user) is None


def _scoped_branches(user):
    scope = branch_scope(user)
    qs = Branch.objects.all()
    return qs if scope is None else qs.filter(pk__in=scope)


class AdminBranchOptionsView(generics.ListAPIView):
    """Id/name list of the branches the current staff member may operate on (for filters and pickers)."""

    permission_classes = [IsStaff]
    serializer_class = BranchOptionSerializer
    pagination_class = None
    filter_backends: list = []

    def get_queryset(self):
        return _scoped_branches(self.request.user).order_by("sort_order", "name")


class AdminBranchViewSet(ImageActionsMixin, StaffModelViewSet):
    """Branch settings. Create/delete: branches.manage + global scope. Update: branches.manage within scope; managers of a
    single branch cannot change code, slug, is_active or sort_order."""

    read_capability = "branches.view"
    write_capability = "branches.manage"
    serializer_class = AdminBranchSerializer
    audit_prefix = "branch"
    image_audit_action = "branch.image"
    audit_fields = [
        "code",
        "name",
        "slug",
        "description",
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
    ]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["is_active", "pickup_enabled", "delivery_enabled", "accepting_orders"]
    search_fields = ["name", "code", "city"]
    ordering_fields = ["name", "sort_order", "city"]
    ordering = ["sort_order", "name"]

    def get_queryset(self):
        return _scoped_branches(self.request.user)

    def get_permissions(self):
        perms = super().get_permissions()
        if self.action in ("create", "destroy"):
            perms.append(GlobalScopeRequired())
        return perms

    def check_update_allowed(self, instance, validated_data):
        if branch_scope(self.request.user) is None:
            return

        def changed(field):
            new, old = validated_data[field], getattr(instance, field)
            return str(new).upper() != str(old).upper() if field == "code" else new != old

        touched = [f for f in GLOBAL_ONLY_FIELDS if f in validated_data and changed(f)]
        if touched:
            raise DomainError(
                f"Only administrators can change: {', '.join(sorted(touched))}.",
                code="global_scope_required",
                status_code=403,
                fields={f: ["Only administrators can change this."] for f in touched},
            )

    def blocked_delete(self, instance):
        count = instance.orders.count()
        if count:
            return DomainError(
                f"{instance.name} has {count} order(s) on record and cannot be deleted. Deactivate it instead.",
                code="has_orders",
                status_code=409,
                extra={"order_count": count},
            )
        return None

    def _audit(self, request, branch, action_name, summary, changes):
        audit(request.user, action_name, branch, summary=summary, changes=changes, request=request)
        bump("catalog")

    # ── hours ──
    @extend_schema(request=BranchHoursWriteSerializer, responses=BranchHoursSerializer(many=True))
    @action(detail=True, methods=["get", "put"], url_path="hours")
    def hours(self, request, pk=None):
        branch = self.get_object()
        if request.method == "GET":
            return Response(BranchHoursSerializer(_week(branch), many=True).data)
        data = request.data if isinstance(request.data, dict) else {"hours": request.data}
        serializer = BranchHoursWriteSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        given = {h["weekday"]: h for h in serializer.validated_data["hours"]}
        before = [BranchHoursSerializer(h).data for h in _week(branch)]
        with transaction.atomic():
            BranchHours.objects.filter(branch=branch).delete()
            BranchHours.objects.bulk_create(
                [
                    BranchHours(
                        branch=branch,
                        weekday=day,
                        is_closed=given.get(day, {"is_closed": True})["is_closed"],
                        opens=given.get(day, {}).get("opens"),
                        closes=given.get(day, {}).get("closes"),
                    )
                    for day in range(7)
                ]
            )
            after = [BranchHoursSerializer(h).data for h in _week(branch)]
            self._audit(
                request,
                branch,
                "branch.hours",
                f"Opening hours of {branch.name} replaced",
                {"old": before, "new": after},
            )
        return Response(after)

    # ── closures ──
    @extend_schema(
        request=BranchClosureSerializer,
        responses={200: BranchClosureSerializer(many=True), 201: BranchClosureSerializer},
    )
    @action(detail=True, methods=["get", "post"], url_path="closures")
    def closures(self, request, pk=None):
        branch = self.get_object()
        if request.method == "GET":
            return Response(BranchClosureSerializer(branch.closures.all(), many=True).data)
        serializer = BranchClosureSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            closure = serializer.save(branch=branch)
            self._audit(
                request,
                branch,
                "branch.closure_add",
                f"Closure added to {branch.name}",
                {"start": str(closure.start_date), "end": str(closure.end_date), "reason": closure.reason},
            )
        return Response(BranchClosureSerializer(closure).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=BranchClosureSerializer, responses=BranchClosureSerializer)
    @action(detail=True, methods=["patch", "delete"], url_path=r"closures/(?P<closure_id>\d+)")
    def closure_detail(self, request, pk=None, closure_id=None):
        branch = self.get_object()
        closure = get_object_or_404(branch.closures.all(), pk=closure_id)
        if request.method == "DELETE":
            with transaction.atomic():
                info = {"start": str(closure.start_date), "end": str(closure.end_date)}
                closure.delete()
                self._audit(request, branch, "branch.closure_remove", f"Closure removed from {branch.name}", info)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = BranchClosureSerializer(closure, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            closure = serializer.save()
            self._audit(
                request,
                branch,
                "branch.closure_update",
                f"Closure of {branch.name} updated",
                dict(serializer.validated_data),
            )
        return Response(BranchClosureSerializer(closure).data)

    # ── delivery zone links ──
    @extend_schema(
        request=BranchZoneLinkSerializer,
        responses={200: BranchZoneLinkSerializer(many=True), 201: BranchZoneLinkSerializer},
    )
    @action(detail=True, methods=["get", "post"], url_path="zones")
    def zones(self, request, pk=None):
        branch = self.get_object()
        if request.method == "GET":
            return Response(BranchZoneLinkSerializer(self._links(branch), many=True).data)
        serializer = BranchZoneLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        zone = serializer.validated_data["zone"]
        if BranchDeliveryZone.objects.filter(branch=branch, zone=zone).exists():
            raise DomainError(
                "This zone is already linked to the branch.",
                code="validation_error",
                fields={"zone": ["Already linked."]},
            )
        with transaction.atomic():
            link = serializer.save(branch=branch)
            self._audit(
                request,
                branch,
                "branch.zone_add",
                f"{zone.name} linked to {branch.name}",
                {"zone": zone.name, "fee": str(link.fee)},
            )
        return Response(BranchZoneLinkSerializer(link).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=BranchZoneLinkSerializer, responses=BranchZoneLinkSerializer)
    @action(detail=True, methods=["patch", "delete"], url_path=r"zones/(?P<link_id>\d+)")
    def zone_detail(self, request, pk=None, link_id=None):
        branch = self.get_object()
        link = get_object_or_404(self._links(branch), pk=link_id)
        if request.method == "DELETE":
            with transaction.atomic():
                name = link.zone.name
                link.delete()
                self._audit(
                    request, branch, "branch.zone_remove", f"{name} unlinked from {branch.name}", {"zone": name}
                )
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = BranchZoneLinkSerializer(link, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fields = ["fee", "min_order_total", "free_delivery_over", "eta_minutes", "is_active"]
        before = snapshot(link, fields)
        with transaction.atomic():
            link = serializer.save()
            changes = diff(before, snapshot(link, fields))
            if changes:
                self._audit(
                    request, branch, "branch.zone_update", f"Zone {link.zone.name} of {branch.name} updated", changes
                )
        return Response(BranchZoneLinkSerializer(link).data)

    @staticmethod
    def _links(branch):
        return BranchDeliveryZone.objects.filter(branch=branch).select_related("zone").order_by("zone__name")

    # ── staff ──
    @extend_schema(responses=BranchStaffSerializer(many=True))
    @action(detail=True, methods=["get"], url_path="staff")
    def staff(self, request, pk=None):
        branch = self.get_object()
        profiles = StaffProfile.objects.filter(branches=branch).select_related("user").order_by("user__email")
        return Response(BranchStaffSerializer(profiles, many=True).data)


def _week(branch):
    return list(BranchHours.objects.filter(branch=branch).order_by("weekday"))


class DeliveryZoneWritePermission(BasePermission):
    """Read: branches.view. Write: branches.manage and global scope (zones are shared by every branch)."""

    message = "Only administrators can change delivery zones."

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return HasCapability.require("branches.view")().has_permission(request, view)
        return (
            HasCapability.require("branches.manage")().has_permission(request, view)
            and branch_scope(request.user) is None
        )


class AdminDeliveryZoneViewSet(viewsets.ModelViewSet):
    permission_classes = [DeliveryZoneWritePermission]
    serializer_class = AdminDeliveryZoneSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["is_active"]
    search_fields = ["name", "slug"]
    ordering_fields = ["name", "branch_count"]
    ordering = ["name"]

    def get_queryset(self):
        return DeliveryZone.objects.annotate(branch_count=Count("branch_links", distinct=True))

    def _log(self, request, name, zone, summary, changes):
        audit(request.user, name, zone, summary=summary, changes=changes, request=request)
        bump("catalog")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            zone = serializer.save()
            self._log(
                request,
                "delivery_zone.create",
                zone,
                f"Delivery zone {zone.name} created",
                {"name": zone.name, "is_active": zone.is_active},
            )
        return Response(self.get_serializer(self.get_queryset().get(pk=zone.pk)).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        zone = self.get_object()
        before = snapshot(zone, ["name", "slug", "is_active"])
        serializer = self.get_serializer(zone, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            zone = serializer.save()
            changes = diff(before, snapshot(zone, ["name", "slug", "is_active"]))
            if changes:
                self._log(request, "delivery_zone.update", zone, f"Delivery zone {zone.name} updated", changes)
        return Response(self.get_serializer(self.get_queryset().get(pk=zone.pk)).data)

    def destroy(self, request, *args, **kwargs):
        zone = self.get_object()
        addresses = zone.addresses.count()
        links = zone.branch_links.count()
        if addresses or links:
            raise DomainError(
                f"{zone.name} is used by {links} branch(es) and {addresses} saved address(es). Deactivate it instead of deleting.",
                code="in_use",
                status_code=409,
                extra={"branch_count": links, "address_count": addresses},
            )
        with transaction.atomic():
            name, pk = zone.name, zone.pk
            zone.delete()
            audit(
                request.user,
                "delivery_zone.delete",
                None,
                resource_type="branches.DeliveryZone",
                resource_id=str(pk),
                summary=f"Delivery zone {name} deleted",
                request=request,
            )
        bump("catalog")
        return Response(status=status.HTTP_204_NO_CONTENT)
