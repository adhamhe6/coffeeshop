"""Staff reporting API: `admin/dashboard/` and `admin/reports/*`.

Authorization: `dashboard.view` for the dashboard, `reports.view` for reports, plus `reports.export` for `?format=csv`.
Branch scoping happens in `context.build_context` (out-of-scope branch -> 404; scoped staff never see other branches).
"""

from __future__ import annotations

import logging

from django.core.exceptions import PermissionDenied
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.permissions import BasePermission
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasCapability, has_capability
from apps.core.cache import cached
from apps.core.pagination import StandardPagination

from . import selectors as sel
from .context import ReportContext, ReportQuerySerializer, build_context
from .csv_export import Section, csv_response, safe_filename
from .definitions import DEFINITIONS
from .serializers import (
    BranchesReportSerializer,
    CategoriesReportSerializer,
    CustomersReportSerializer,
    DashboardSerializer,
    DefinitionSerializer,
    InventoryQuerySerializer,
    InventoryReportSerializer,
    OrdersByStatusReportSerializer,
    PaymentsReportSerializer,
    ProductsQuerySerializer,
    ProductsReportSerializer,
    PromotionsReportSerializer,
    RefundsReportSerializer,
    SalesReportSerializer,
)

log = logging.getLogger(__name__)

DASHBOARD_CACHE_TTL = 60

FORMAT_PARAM = OpenApiParameter(
    "format",
    str,
    OpenApiParameter.QUERY,
    enum=["json", "csv"],
    description="`csv` streams a spreadsheet export (requires the reports.export capability).",
    required=False,
)
PAGE_PARAMS = [
    OpenApiParameter("page", int, OpenApiParameter.QUERY, required=False),
    OpenApiParameter("page_size", int, OpenApiParameter.QUERY, required=False, description="Default 20, max 100"),
]


class AnyCapability(BasePermission):
    """Allow staff holding at least one of `capabilities`."""

    capabilities: tuple[str, ...] = ()

    @classmethod
    def of(cls, *capabilities: str):
        return type(
            "AnyOf_" + "_".join(c.replace(".", "_") for c in capabilities), (cls,), {"capabilities": capabilities}
        )

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and any(has_capability(user, c) for c in self.capabilities))


class ReportPagination(StandardPagination):
    pass


class BaseReportView(APIView):
    """JSON by default; `?format=csv` streams a CSV when the user may export."""

    permission_classes = [HasCapability.require("reports.view")]
    query_serializer: type[serializers.Serializer] = ReportQuerySerializer
    report_key = ""
    paginated = False
    csv_enabled = True

    def perform_content_negotiation(self, request, force=False):
        # `?format=` is ours (json|csv), not DRF's renderer override, so always answer with the JSON renderer.
        renderer = JSONRenderer()
        return renderer, renderer.media_type

    # -- subclass hooks ------------------------------------------------------------------------------------------
    def compute(self, ctx: ReportContext) -> dict:  # pragma: no cover - abstract
        raise NotImplementedError

    def csv_sections(self, ctx: ReportContext, data: dict) -> list[Section]:  # pragma: no cover - abstract
        raise NotImplementedError

    def serialize(self, ctx: ReportContext, data: dict) -> dict:
        raise NotImplementedError

    # -- flow ----------------------------------------------------------------------------------------------------
    def get(self, request):
        fmt = request.query_params.get("format", "json").lower()
        if fmt not in ("json", "csv") or (fmt == "csv" and not self.csv_enabled):
            raise serializers.ValidationError({"format": ["Use format=json or format=csv."]})
        if fmt == "csv" and not has_capability(request.user, "reports.export"):
            raise PermissionDenied("You do not have permission to export reports.")
        ctx = build_context(request, self.query_serializer)
        data = self.compute(ctx)
        if fmt == "csv":
            return self.csv(request, ctx, data)
        return Response(self.serialize(ctx, data))

    def csv(self, request, ctx: ReportContext, data: dict):
        log.info(
            "report export",
            extra={
                "report": self.report_key,
                "user_id": request.user.pk,
                "date_from": str(ctx.date_from),
                "date_to": str(ctx.date_to),
            },
        )
        name = safe_filename(
            self.report_key,
            f"branch-{ctx.selected_branch}" if ctx.selected_branch else "",
            f"{ctx.date_from.isoformat()}_to_{ctx.date_to.isoformat()}",
        )
        return csv_response(name, self.csv_sections(ctx, data))

    def paginate(self, request, rows) -> tuple[list, dict]:
        paginator = ReportPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        links = {
            "count": paginator.page.paginator.count,
            "next": paginator.get_next_link(),
            "previous": paginator.get_previous_link(),
        }
        return page, links


def _report_schema(serializer, *, paginated=False, extra_params=None, summary: str):
    params = [ReportQuerySerializer, FORMAT_PARAM, *(PAGE_PARAMS if paginated else []), *(extra_params or [])]
    return extend_schema(
        summary=summary,
        parameters=params,
        responses={200: serializer, 400: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT},
        tags=["reports"],
    )


# ---------------------------------------------------------------------------------------------------------------------
# definitions
# ---------------------------------------------------------------------------------------------------------------------
class DefinitionsView(APIView):
    permission_classes = [AnyCapability.of("reports.view", "dashboard.view")]
    pagination_class = None

    @extend_schema(summary="Metric definitions", responses=DefinitionSerializer(many=True), tags=["reports"])
    def get(self, request):
        return Response(DefinitionSerializer(DEFINITIONS, many=True).data)


# ---------------------------------------------------------------------------------------------------------------------
# dashboard
# ---------------------------------------------------------------------------------------------------------------------
class DashboardView(BaseReportView):
    permission_classes = [HasCapability.require("dashboard.view")]
    report_key = "dashboard"
    csv_enabled = False

    @extend_schema(
        summary="Dashboard overview",
        description="KPIs with previous-period comparison, series, breakdowns and attention counts. Cached for 60 s "
        "per branch scope and parameters.",
        parameters=[ReportQuerySerializer],
        responses={200: DashboardSerializer, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT},
        tags=["reports"],
    )
    def get(self, request):
        return super().get(request)

    def compute(self, ctx: ReportContext) -> dict:
        # The key carries the *effective* branch scope (and the selected branch / capability that shape the payload),
        # so one scope's numbers can never be served to staff of another scope.
        parts = (
            "dashboard",
            ctx.signature,
            ctx.selected_branch,
            ctx.date_from.isoformat(),
            ctx.date_to.isoformat(),
            ctx.granularity,
            has_capability(ctx.user, "customers.view"),
        )
        return cached(
            "reports", parts, lambda: dict(DashboardSerializer(sel.dashboard(ctx)).data), ttl=DASHBOARD_CACHE_TTL
        )

    def serialize(self, ctx, data):
        return data


# ---------------------------------------------------------------------------------------------------------------------
# reports
# ---------------------------------------------------------------------------------------------------------------------
SALES_COLUMNS = [
    ("Date", "bucket"),
    ("Orders", "orders"),
    ("Gross sales", "gross_sales"),
    ("Discounts", "discounts"),
    ("Delivery fees", "delivery_fees"),
    ("Tax", "tax"),
    ("Refunds", "refunds"),
    ("Net sales", "net_sales"),
    ("Revenue collected", "revenue_collected"),
    ("Average order value", "average_order_value"),
]


class SalesReportView(BaseReportView):
    report_key = "sales"

    @_report_schema(SalesReportSerializer, summary="Sales by day / week / month")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        rows = sel.sales_series(ctx)
        return {"totals": sel.sales_totals(rows), "results": rows}

    def serialize(self, ctx, data):
        return SalesReportSerializer({"period": ctx.period(), **data}).data

    def csv_sections(self, ctx, data):
        return [Section("Sales", SALES_COLUMNS, data["results"], data["totals"])]


class OrdersByStatusReportView(BaseReportView):
    report_key = "orders-by-status"

    @_report_schema(OrdersByStatusReportSerializer, summary="Orders by status")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        totals = sel.order_totals(ctx, ctx.window)
        return {
            "totals": totals,
            "results": sel.status_breakdown(totals),
        }

    def serialize(self, ctx, data):
        return OrdersByStatusReportSerializer({"period": ctx.period(), **data}).data

    def csv_sections(self, ctx, data):
        totals = {"count": data["totals"]["orders_total"], "share": 100.0 if data["totals"]["orders_total"] else 0.0}
        return [
            Section(
                "Orders by status",
                [("Status", "label"), ("Orders", "count"), ("Share %", "share")],
                data["results"],
                totals,
            )
        ]


class ProductsReportView(BaseReportView):
    report_key = "products"
    query_serializer = ProductsQuerySerializer

    @_report_schema(
        ProductsReportSerializer, paginated=True, extra_params=[ProductsQuerySerializer], summary="Product sales"
    )
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        rows, totals = sel.product_rows(ctx, ctx.extra.get("ordering", "-net"))
        return {"totals": totals, "results": rows}

    def serialize(self, ctx, data):
        page, links = self.paginate(self.request, data["results"])
        return ProductsReportSerializer(
            {**links, "period": ctx.period(), "totals": data["totals"], "results": page}
        ).data

    def csv_sections(self, ctx, data):
        cols = [
            ("SKU", "sku"),
            ("Product", "product_name"),
            ("Category", "category_name"),
            ("Units", "units"),
            ("Orders", "orders"),
            ("Gross", "gross"),
            ("Discounts", "discounts"),
            ("Net", "net"),
            ("Share %", "share"),
        ]
        return [Section("Products", cols, data["results"], data["totals"])]


class CategoriesReportView(BaseReportView):
    report_key = "categories"

    @_report_schema(CategoriesReportSerializer, summary="Category sales")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        rows, totals = sel.category_rows(ctx)
        return {"totals": totals, "results": rows}

    def serialize(self, ctx, data):
        return CategoriesReportSerializer({"period": ctx.period(), **data}).data

    def csv_sections(self, ctx, data):
        cols = [
            ("Category", "category"),
            ("Units", "units"),
            ("Orders", "orders"),
            ("Gross", "gross"),
            ("Discounts", "discounts"),
            ("Net", "net"),
            ("Share %", "share"),
        ]
        return [Section("Categories", cols, data["results"], data["totals"])]


class BranchesReportView(BaseReportView):
    report_key = "branches"

    @_report_schema(BranchesReportSerializer, summary="Branch performance")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        rows, totals = sel.branch_rows(ctx)
        return {"totals": totals, "results": rows}

    def serialize(self, ctx, data):
        return BranchesReportSerializer({"period": ctx.period(), **data}).data

    def csv_sections(self, ctx, data):
        cols = [
            ("Branch", "branch"),
            ("Time zone", "timezone"),
            ("Orders placed", "orders_total"),
            ("Orders counted", "orders"),
            ("Gross sales", "gross_sales"),
            ("Discounts", "discounts"),
            ("Refunds", "refunds"),
            ("Net sales", "net_sales"),
            ("Revenue collected", "revenue_collected"),
            ("Average order value", "average_order_value"),
        ]
        return [Section("Branches", cols, data["results"], data["totals"])]


class PromotionsReportView(BaseReportView):
    report_key = "promotions"

    @_report_schema(PromotionsReportSerializer, paginated=True, summary="Promotion performance")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        rows, totals = sel.promotion_rows(ctx)
        return {"totals": totals, "results": rows}

    def serialize(self, ctx, data):
        page, links = self.paginate(self.request, data["results"])
        return PromotionsReportSerializer(
            {**links, "period": ctx.period(), "totals": data["totals"], "results": page}
        ).data

    def csv_sections(self, ctx, data):
        cols = [
            ("Code", "code"),
            ("Name", "name"),
            ("Automatic", "is_automatic"),
            ("Active", "is_active"),
            ("Redemptions", "redemptions"),
            ("Discount given", "discount_given"),
            ("Orders", "orders"),
            ("Revenue influenced", "revenue_influenced"),
        ]
        return [Section("Promotions", cols, data["results"], data["totals"])]


class PaymentsReportView(BaseReportView):
    report_key = "payments"

    @_report_schema(PaymentsReportSerializer, summary="Payments by provider and status")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        rows, totals, failures = sel.payment_report(ctx)
        return {"totals": totals, "results": rows, "failures": failures}

    def serialize(self, ctx, data):
        return PaymentsReportSerializer({"period": ctx.period(), **data}).data

    def csv_sections(self, ctx, data):
        cols = [
            ("Provider", "provider"),
            ("Status", "status"),
            ("Sandbox", "is_sandbox"),
            ("Payments", "count"),
            ("Amount", "amount"),
            ("Refunded", "refunded"),
        ]
        totals = {
            "count": data["totals"]["payments"],
            "amount": data["totals"]["amount"],
            "refunded": data["totals"]["refunded_amount"],
        }
        fail_cols = [
            ("Provider", "provider"),
            ("Failure code", "failure_code"),
            ("Failures", "count"),
            ("Amount", "amount"),
        ]
        return [
            Section("Payments", cols, data["results"], totals),
            Section("Top failure reasons", fail_cols, data["failures"]),
        ]


class RefundsReportView(BaseReportView):
    report_key = "refunds"

    @_report_schema(RefundsReportSerializer, paginated=True, summary="Refunds and cancellations")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        totals, cancellations = sel.refund_report(ctx)
        return {"totals": totals, "results": sel.refund_rows_queryset(ctx), "cancellations": cancellations}

    def serialize(self, ctx, data):
        page, links = self.paginate(self.request, data["results"])
        return RefundsReportSerializer(
            {
                **links,
                "period": ctx.period(),
                "totals": data["totals"],
                "results": page,
                "cancellations": data["cancellations"],
            }
        ).data

    def csv_sections(self, ctx, data):
        cols = [
            ("Order", "order_number"),
            ("Date", "created_at"),
            ("Provider", "provider"),
            ("Sandbox", "is_sandbox"),
            ("Amount", "amount"),
            ("Status", "status"),
            ("Reason", "reason"),
            ("Order status", "order_status"),
            ("Counted in sales", "counted_in_sales"),
        ]
        cancel_cols = [
            ("Order", "number"),
            ("Cancelled at", "cancelled_at"),
            ("Reason", "cancel_reason"),
            ("Payment status", "payment_status"),
            ("Total", "total"),
            ("Refunded", "refunded_total"),
            ("Refund needed", "refund_needed"),
            ("Amount to refund", "amount_to_refund"),
        ]
        return [
            Section("Refunds", cols, data["results"].iterator(chunk_size=2000)),
            Section("Cancelled orders", cancel_cols, data["cancellations"]),
        ]


class InventoryReportView(BaseReportView):
    report_key = "inventory"
    query_serializer = InventoryQuerySerializer

    @_report_schema(
        InventoryReportSerializer,
        paginated=True,
        extra_params=[InventoryQuerySerializer],
        summary="Inventory and stock movements",
    )
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        totals, low, movements = sel.inventory_report(ctx)
        rows = sel.stock_rows_queryset(ctx, ctx.extra.get("ordering", "status"), ctx.extra.get("status"))
        return {"totals": totals, "results": rows, "low_stock": low, "movements": movements}

    def serialize(self, ctx, data):
        page, links = self.paginate(self.request, data["results"])
        return InventoryReportSerializer(
            {
                **links,
                "period": ctx.period(),
                "totals": data["totals"],
                "results": page,
                "low_stock": data["low_stock"],
                "movements": data["movements"],
            }
        ).data

    def csv_sections(self, ctx, data):
        cols = [
            ("Branch", "branch_name"),
            ("SKU", "sku"),
            ("Product", "product_name"),
            ("Category", "category_name"),
            ("Quantity", "quantity"),
            ("Low-stock threshold", "low_stock_threshold"),
            ("Unit cost", "unit_cost"),
            ("Value", "value"),
            ("Status", "status"),
            ("Published", "is_active"),
        ]
        totals = {"quantity": data["totals"]["units_on_hand"], "value": data["totals"]["stock_value"]}
        move_cols = [
            ("Type", "label"),
            ("Movements", "movements"),
            ("Units in", "units_in"),
            ("Units out", "units_out"),
            ("Net units", "net_units"),
        ]
        return [
            Section("Stock on hand", cols, data["results"].iterator(chunk_size=2000), totals),
            Section("Stock movements in period", move_cols, data["movements"]),
        ]


class CustomersReportView(BaseReportView):
    report_key = "customers"

    @_report_schema(CustomersReportSerializer, summary="Customer frequency, new vs returning, top customers")
    def get(self, request):
        return super().get(request)

    def compute(self, ctx):
        totals, buckets, segments, top = sel.customer_report(ctx)
        return {"totals": totals, "results": buckets, "new_vs_returning": segments, "top_customers": top}

    def serialize(self, ctx, data):
        return CustomersReportSerializer({"period": ctx.period(), **data}).data

    def csv_sections(self, ctx, data):
        t = data["totals"]
        return [
            Section(
                "Order frequency",
                [("Orders in period", "label"), ("Customers", "customers"), ("Share %", "share")],
                data["results"],
                {"customers": t["customers"]},
            ),
            Section(
                "New vs returning",
                [("Segment", "label"), ("Customers", "customers"), ("Share %", "share")],
                data["new_vs_returning"],
            ),
            Section(
                "Top customers by spend",
                [
                    ("Customer", "name"),
                    ("Email", "email"),
                    ("Phone", "phone"),
                    ("Orders", "orders"),
                    ("Spend", "spend"),
                    ("Last order", "last_order_at"),
                ],
                data["top_customers"],
            ),
        ]
