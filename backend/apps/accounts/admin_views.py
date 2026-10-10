"""Staff API: customers and staff accounts."""

from __future__ import annotations

import logging
from decimal import Decimal

import django_filters
from django.db.models import Count, DecimalField, Exists, F, Max, OuterRef, Prefetch, Q, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from apps.core.audit import audit

from . import services
from .models import Address, StaffProfile, User
from .permissions import ALL_CAPABILITIES, HasCapability, branch_scope, staff_role
from .serializers import (
    CustomerDetailSerializer,
    CustomerListSerializer,
    CustomerSuspendSerializer,
    RoleMatrixSerializer,
    StaffCreateSerializer,
    StaffSerializer,
    StaffWriteSerializer,
)

log = logging.getLogger(__name__)

# Same "counted" definition as reports: completed orders that are paid (or cash collected at handover).
_COUNTED = Q(orders__status="COMPLETED") & (
    Q(orders__payment_status__in=["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]) | Q(orders__payment_method="cash")
)


def customer_queryset(staff_user):
    """Customers (non-staff users) with SQL-aggregated order stats, scoped for branch managers."""
    from apps.orders.models import Order

    scope = branch_scope(staff_user) if staff_role(staff_user) == "BRANCH_MANAGER" else None
    in_scope = Q() if scope is None else Q(orders__branch_id__in=scope)
    qs = User.objects.filter(staff_profile__isnull=True)
    if scope is not None:
        qs = qs.filter(Exists(Order.objects.filter(customer=OuterRef("pk"), branch_id__in=scope)))
    return qs.annotate(
        order_count=Count("orders", filter=_COUNTED & in_scope),
        lifetime_spend=Coalesce(
            Sum(F("orders__total") - F("orders__refunded_total"), filter=_COUNTED & in_scope),
            Decimal("0.00"),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        ),
        last_order_at=Max("orders__placed_at", filter=in_scope),
    )


class CustomerFilter(django_filters.FilterSet):
    class Meta:
        model = User
        fields = ["is_active"]


@extend_schema(tags=["admin: customers"])
class CustomerViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, GenericViewSet):
    """customers.view to read, customers.manage to suspend/restore. Staff accounts never appear here."""

    permission_classes = [HasCapability.require("customers.view")]
    capability_map = {"POST": "customers.manage"}
    serializer_class = CustomerListSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = CustomerFilter
    search_fields = ["first_name", "last_name", "email", "phone"]
    ordering_fields = [
        "date_joined",
        "last_login",
        "email",
        "last_name",
        "order_count",
        "lifetime_spend",
        "last_order_at",
    ]
    ordering = ["-date_joined", "-id"]

    def get_queryset(self):
        qs = customer_queryset(self.request.user)
        if self.action == "retrieve":
            qs = qs.prefetch_related(
                Prefetch(
                    "addresses",
                    queryset=Address.objects.filter(is_deleted=False).select_related("zone"),
                    to_attr="active_addresses",
                )
            )
        return qs

    def get_serializer_class(self):
        return CustomerListSerializer if self.action == "list" else CustomerDetailSerializer

    def _with_recent_orders(self, customer):
        from apps.orders.models import Order

        orders = Order.objects.filter(customer=customer).select_related("branch")
        scope = branch_scope(self.request.user) if staff_role(self.request.user) == "BRANCH_MANAGER" else None
        if scope is not None:
            orders = orders.filter(branch_id__in=scope)
        customer.recent_orders = list(orders[:10])
        if not hasattr(customer, "active_addresses"):
            customer.active_addresses = list(
                Address.objects.filter(user=customer, is_deleted=False).select_related("zone")
            )
        return customer

    @extend_schema(summary="Customer profile, addresses and recent orders", responses={200: CustomerDetailSerializer})
    def retrieve(self, request, *args, **kwargs):
        customer = self._with_recent_orders(self.get_object())
        return Response(CustomerDetailSerializer(customer).data)

    def _set_active(self, request, pk, active: bool, reason: str = ""):
        customer = self.get_object()
        if customer.is_active != active:
            customer.is_active = active
            customer.restriction_reason = "" if active else reason
            customer.save(update_fields=["is_active", "restriction_reason"])
            audit(
                request.user,
                "customer.restore" if active else "customer.suspend",
                customer,
                summary=f"{'Restored' if active else 'Suspended'} customer {customer.email}",
                changes={} if active else {"reason": reason},
                request=request,
            )
            log.info(
                "customer %s by staff %s user_id=%s",
                "restored" if active else "suspended",
                request.user.pk,
                customer.pk,
            )
        customer = self._with_recent_orders(get_object_or_404(self.get_queryset(), pk=customer.pk))
        return Response(CustomerDetailSerializer(customer).data)

    @extend_schema(
        request=CustomerSuspendSerializer,
        responses={200: CustomerDetailSerializer},
        summary="Suspend a customer account",
    )
    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        serializer = CustomerSuspendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._set_active(request, pk, False, serializer.validated_data["reason"])

    @extend_schema(request=None, responses={200: CustomerDetailSerializer}, summary="Restore a suspended customer")
    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        return self._set_active(request, pk, True)


class StaffFilter(django_filters.FilterSet):
    role = django_filters.ChoiceFilter(field_name="staff_profile__role", choices=StaffProfile.Role.choices)

    class Meta:
        model = User
        fields = ["role", "is_active"]


@extend_schema(tags=["admin: staff"])
class StaffViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, GenericViewSet):
    permission_classes = [HasCapability.require("staff.manage")]
    serializer_class = StaffSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = StaffFilter
    search_fields = ["first_name", "last_name", "email", "staff_profile__job_title"]
    ordering_fields = ["email", "last_name", "date_joined", "last_login"]
    ordering = ["email"]

    def get_queryset(self):
        return (
            User.objects.filter(staff_profile__isnull=False)
            .select_related("staff_profile")
            .prefetch_related("staff_profile__branches")
        )

    def _fresh(self, user):
        return StaffSerializer(self.get_queryset().get(pk=user.pk)).data

    @extend_schema(summary="Create a staff account", request=StaffCreateSerializer, responses={201: StaffSerializer})
    def create(self, request):
        serializer = StaffCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        user = services.create_staff(
            request.user,
            request,
            email=data["email"],
            password=data["password"],
            first_name=data["first_name"],
            last_name=data.get("last_name", ""),
            phone=data.get("phone", ""),
            role=data["role"],
            job_title=data.get("job_title", ""),
            branch_ids=data.get("branch_ids", []),
        )
        return Response(self._fresh(user), status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Update role, branches or profile", request=StaffWriteSerializer, responses={200: StaffSerializer}
    )
    def partial_update(self, request, pk=None):
        target = self.get_object()
        serializer = StaffWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = services.update_staff(request.user, request, target, dict(serializer.validated_data))
        return Response(self._fresh(user))

    @extend_schema(summary="Role to capability matrix", responses={200: RoleMatrixSerializer})
    @action(detail=False, methods=["get"], url_path="roles", filter_backends=[], pagination_class=None)
    def roles(self, request):
        return Response({"capabilities": list(ALL_CAPABILITIES), "roles": services.role_matrix()})

    @extend_schema(summary="Deactivate a staff account", request=None, responses={200: StaffSerializer})
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        user = services.set_staff_active(request.user, request, self.get_object(), False)
        return Response(self._fresh(user))

    @extend_schema(summary="Reactivate a staff account", request=None, responses={200: StaffSerializer})
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        user = services.set_staff_active(request.user, request, self.get_object(), True)
        return Response(self._fresh(user))
