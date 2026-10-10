"""Staff API for inventory (inventory.view / inventory.manage), always limited to the staff member's branch scope."""

from __future__ import annotations

import django_filters
from django.db.models import DecimalField, ExpressionWrapper, F, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from django_filters.widgets import BooleanWidget
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import filters, generics, mixins, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import branch_scope
from apps.branches.models import Branch
from apps.catalog.models import Product
from apps.catalog.staff import CapabilityViewMixin, diff, snapshot
from apps.core.audit import audit
from apps.core.pagination import StandardPagination

from . import services
from .admin_serializers import (
    AdjustResultSerializer,
    AdjustStockSerializer,
    AvailabilityRowSerializer,
    AvailabilityUpdateSerializer,
    InventorySummarySerializer,
    MovementSerializer,
    StockItemSerializer,
    StockItemUpdateSerializer,
)
from .models import BranchProduct, InventoryMovement, StockItem

VALUE = ExpressionWrapper(F("quantity") * F("unit_cost"), output_field=DecimalField(max_digits=16, decimal_places=2))


def scoped_branches(user):
    scope = branch_scope(user)
    qs = Branch.objects.all()
    return qs if scope is None else qs.filter(pk__in=scope)


def scoped_branch_or_404(user, branch_id):
    return get_object_or_404(scoped_branches(user), pk=branch_id)


class StockFilter(django_filters.FilterSet):
    branch = django_filters.NumberFilter(field_name="branch_id")
    product = django_filters.NumberFilter(field_name="product_id")
    q = django_filters.CharFilter(method="filter_q", help_text="Product name or SKU contains")
    low = django_filters.BooleanFilter(method="filter_low", widget=BooleanWidget(), help_text="At or below threshold")
    out_of_stock = django_filters.BooleanFilter(method="filter_out", widget=BooleanWidget())

    class Meta:
        model = StockItem
        fields: list[str] = []

    def filter_q(self, queryset, name, value):
        value = value.strip()
        return (
            queryset.filter(Q(product__name__icontains=value) | Q(product__sku__icontains=value)) if value else queryset
        )

    def filter_low(self, queryset, name, value):
        low = Q(quantity__lte=F("low_stock_threshold"))
        return queryset.filter(low) if value else queryset.exclude(low)

    def filter_out(self, queryset, name, value):
        return queryset.filter(quantity=0) if value else queryset.exclude(quantity=0)


class StockViewSet(
    CapabilityViewMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Stock rows per branch and STOCKED product. PATCH changes the low-stock threshold and unit cost only."""

    read_capability = "inventory.view"
    write_capability = "inventory.manage"
    http_method_names = ["get", "patch", "head", "options"]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = StockFilter
    ordering_fields = ["product__name", "quantity", "stock_value", "updated_at", "branch__name", "low_stock_threshold"]
    ordering = ["branch__name", "product__name", "id"]

    def get_queryset(self):
        qs = StockItem.objects.select_related("branch", "product").annotate(stock_value=VALUE)
        scope = branch_scope(self.request.user)
        return qs if scope is None else qs.filter(branch_id__in=scope)

    def get_serializer_class(self):
        return StockItemUpdateSerializer if self.action == "partial_update" else StockItemSerializer

    @extend_schema(request=StockItemUpdateSerializer, responses=StockItemSerializer)
    def partial_update(self, request, *args, **kwargs):
        item = self.get_object()
        fields = ["low_stock_threshold", "unit_cost"]
        before = snapshot(item, fields)
        serializer = StockItemUpdateSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        item = serializer.save()
        changes = diff(before, snapshot(item, fields))
        if changes:
            audit(
                request.user,
                "inventory.stock_update",
                item,
                summary=f"Stock settings of {item.product.name} @ {item.branch.name}: {', '.join(sorted(changes))}"[
                    :300
                ],
                changes=changes,
                request=request,
            )
        return Response(StockItemSerializer(self.get_queryset().get(pk=item.pk)).data)


class AdjustStockView(CapabilityViewMixin, APIView):
    read_capability = write_capability = "inventory.manage"

    @extend_schema(request=AdjustStockSerializer, responses={201: AdjustResultSerializer})
    def post(self, request):
        serializer = AdjustStockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        branch = scoped_branch_or_404(request.user, data["branch"])  # out of scope = 404
        product = get_object_or_404(Product, pk=data["product"])
        item = services.adjust_stock(
            branch,
            product,
            delta=data.get("delta"),
            set_to=data.get("set_to"),
            movement_type=data["movement_type"],
            reason=data["reason"],
            actor=request.user,
            reference=data["reference"],
        )
        fresh = StockItem.objects.select_related("branch", "product").annotate(stock_value=VALUE).get(pk=item.pk)
        return Response(
            {"stock_item": StockItemSerializer(fresh).data, "movement": MovementSerializer(item.last_movement).data},
            status=status.HTTP_201_CREATED,
        )


class MovementFilter(django_filters.FilterSet):
    branch = django_filters.NumberFilter(field_name="stock_item__branch_id")
    product = django_filters.NumberFilter(field_name="stock_item__product_id")
    type = django_filters.ChoiceFilter(field_name="movement_type", choices=InventoryMovement.Type.choices)
    actor = django_filters.NumberFilter(field_name="actor_id")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    reference = django_filters.CharFilter(lookup_expr="icontains")

    class Meta:
        model = InventoryMovement
        fields: list[str] = []


class MovementViewSet(CapabilityViewMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    read_capability = write_capability = "inventory.view"
    serializer_class = MovementSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = MovementFilter
    ordering_fields = ["created_at", "quantity_delta"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        qs = InventoryMovement.objects.select_related("stock_item__branch", "stock_item__product", "actor")
        scope = branch_scope(self.request.user)
        return qs if scope is None else qs.filter(stock_item__branch_id__in=scope)


class AvailabilityView(CapabilityViewMixin, generics.ListAPIView):
    """Per-branch availability of PREPARED (made-to-order) products. GET needs `?branch=`; PATCH toggles one product."""

    read_capability = "inventory.view"
    write_capability = "inventory.manage"
    serializer_class = AvailabilityRowSerializer
    pagination_class = StandardPagination
    filter_backends: list = []

    def _rows(self, branch, extra: Q | None = None):
        toggle = BranchProduct.objects.filter(branch=branch, product=OuterRef("pk"))
        qs = (
            Product.objects.filter(stock_mode=Product.StockMode.PREPARED, is_active=True)
            .select_related("category")
            .annotate(
                branch_available=Subquery(toggle.values("is_available")[:1]),
                toggled_at=Subquery(toggle.values("updated_at")[:1]),
            )
            .order_by("category__sort_order", "category__name", "sort_order", "name", "id")
        )
        return qs.filter(extra) if extra is not None else qs

    @staticmethod
    def _row(product) -> dict:
        return {
            "product": product,
            "category_name": product.category.name,
            "is_available": product.branch_available is not False,
            "is_sold_out": product.is_sold_out,
            "updated_at": product.toggled_at,
        }

    @extend_schema(
        parameters=[
            OpenApiParameter("branch", int, required=True),
            OpenApiParameter("q", str, description="Product name or SKU contains"),
            OpenApiParameter("category", int),
            OpenApiParameter("available", bool, description="Only available / only unavailable"),
        ]
    )
    def list(self, request, *args, **kwargs):
        raw = request.query_params.get("branch")
        if not raw or not raw.isdigit():
            raise ValidationError({"branch": ["This query parameter is required."]})
        branch = scoped_branch_or_404(request.user, int(raw))
        qs = self._rows(branch)
        q = request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(sku__icontains=q))
        category = request.query_params.get("category")
        if category and category.isdigit():
            qs = qs.filter(category_id=int(category))
        available = request.query_params.get("available")
        if available in ("true", "1"):
            qs = qs.filter(Q(branch_available=True) | Q(branch_available__isnull=True))
        elif available in ("false", "0"):
            qs = qs.filter(branch_available=False)
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(AvailabilityRowSerializer([self._row(p) for p in page], many=True).data)

    @extend_schema(request=AvailabilityUpdateSerializer, responses=AvailabilityRowSerializer)
    def patch(self, request):
        serializer = AvailabilityUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        branch = scoped_branch_or_404(request.user, data["branch"])
        product = get_object_or_404(Product, pk=data["product"])
        if product.stock_mode != Product.StockMode.PREPARED:
            from apps.core.errors import DomainError

            raise DomainError(
                "Stock-managed products are controlled by their quantity; use a stock adjustment.",
                code="not_prepared_product",
                status_code=409,
            )
        row = BranchProduct.objects.filter(branch=branch, product=product).first()
        current = row.is_available if row else True
        if current != data["is_available"]:
            BranchProduct.objects.update_or_create(
                branch=branch, product=product, defaults={"is_available": data["is_available"]}
            )
            audit(
                request.user,
                "inventory.availability",
                product,
                summary=f"{product.name} {'available' if data['is_available'] else 'unavailable'} at {branch.name}",
                changes={"branch": branch.name, "is_available": {"old": current, "new": data["is_available"]}},
                request=request,
            )
        fresh = self._rows(branch, Q(pk=product.pk)).get()
        return Response(AvailabilityRowSerializer(self._row(fresh)).data)


class SummaryView(CapabilityViewMixin, APIView):
    """Dashboard numbers, computed with SQL aggregates. Optional `?branch=` narrows to one (in-scope) branch."""

    read_capability = write_capability = "inventory.view"

    @extend_schema(parameters=[OpenApiParameter("branch", int)], responses=InventorySummarySerializer)
    def get(self, request):
        scope = branch_scope(request.user)
        branches = scoped_branches(request.user)
        raw = request.query_params.get("branch")
        if raw:
            if not raw.isdigit():
                raise ValidationError({"branch": ["Invalid branch id."]})
            branches = branches.filter(pk=int(raw))
            if not branches.exists():
                from django.http import Http404

                raise Http404
        branch_ids = branches.values("pk")
        stock = StockItem.objects.filter(branch_id__in=branch_ids, product__is_active=True)
        low = Q(quantity__lte=F("low_stock_threshold"))
        totals = stock.aggregate(
            tracked=_count(),
            low=_count(low),
            out=_count(Q(quantity=0)),
            valuation=Coalesce(Sum(VALUE, filter=Q(unit_cost__isnull=False)), 0, output_field=DecimalField()),
            unvalued=_count(Q(unit_cost__isnull=True, quantity__gt=0)),
        )

        unavailable = []
        toggled = (
            BranchProduct.objects.filter(
                branch_id__in=branch_ids, is_available=False, product__is_active=True, product__stock_mode="PREPARED"
            )
            .select_related("branch", "product")
            .order_by("branch__name", "product__name")[:50]
        )
        unavailable += [
            {"branch": t.branch, "product": t.product, "reason": "branch_unavailable", "since": t.updated_at}
            for t in toggled
        ]
        empty = (
            stock.filter(quantity=0).select_related("branch", "product").order_by("branch__name", "product__name")[:50]
        )
        unavailable += [
            {"branch": s.branch, "product": s.product, "reason": "out_of_stock", "since": s.updated_at} for s in empty
        ]
        if scope is None and not raw:  # global flag: only meaningful in the all-branches view
            sold_out = Product.objects.filter(is_sold_out=True, is_active=True).order_by("name")[:50]
            unavailable += [
                {"branch": None, "product": p, "reason": "sold_out", "since": p.updated_at} for p in sold_out
            ]
        payload = {
            "tracked_items": totals["tracked"],
            "low_stock_count": totals["low"],
            "out_of_stock_count": totals["out"],
            "valuation": totals["valuation"],
            "unvalued_items": totals["unvalued"],
            "unavailable": unavailable,
        }
        return Response(InventorySummarySerializer(payload).data)


def _count(condition: Q | None = None):
    from django.db.models import Count

    return Count("id", filter=condition)
