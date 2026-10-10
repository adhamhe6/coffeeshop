import django_filters
from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import viewsets

from apps.accounts.permissions import HasCapability
from apps.core.audit import audit
from apps.core.errors import DomainError

from .models import Coupon
from .serializers import AdminCouponSerializer, annotate_stats

TRACKED = [
    "code",
    "name",
    "discount_type",
    "value",
    "max_discount",
    "min_order_total",
    "applies_to",
    "first_order_only",
    "is_automatic",
    "starts_at",
    "ends_at",
    "usage_limit",
    "per_customer_limit",
    "is_active",
]


class CouponFilter(django_filters.FilterSet):
    q = django_filters.CharFilter(method="search", label="Search code or name")
    is_active = django_filters.BooleanFilter()
    is_automatic = django_filters.BooleanFilter()

    class Meta:
        model = Coupon
        fields = ["is_active", "is_automatic", "discount_type", "applies_to"]

    def search(self, queryset, name, value):
        return queryset.filter(Q(code__icontains=value) | Q(name__icontains=value))


def _snapshot(coupon: Coupon) -> dict:
    data = {f: getattr(coupon, f) for f in TRACKED}
    data["categories"] = sorted(coupon.categories.values_list("id", flat=True))
    data["products"] = sorted(coupon.products.values_list("id", flat=True))
    return {k: (str(v) if v is not None and not isinstance(v, (bool, int, list)) else v) for k, v in data.items()}


@extend_schema_view(
    list=extend_schema(operation_id="admin_coupons_list", tags=["admin-coupons"]),
    retrieve=extend_schema(operation_id="admin_coupons_retrieve", tags=["admin-coupons"]),
    create=extend_schema(operation_id="admin_coupons_create", tags=["admin-coupons"]),
    update=extend_schema(operation_id="admin_coupons_update", tags=["admin-coupons"]),
    partial_update=extend_schema(operation_id="admin_coupons_partial_update", tags=["admin-coupons"]),
    destroy=extend_schema(
        operation_id="admin_coupons_destroy",
        description="Only coupons that were never redeemed can be deleted (409 `coupon_has_redemptions`); deactivate others.",
        tags=["admin-coupons"],
    ),
)
class AdminCouponViewSet(viewsets.ModelViewSet):
    """Coupon and automatic-promotion management (capability `promotions.manage`)."""

    permission_classes = [HasCapability.require("promotions.manage")]
    serializer_class = AdminCouponSerializer
    filterset_class = CouponFilter
    ordering_fields = ["created_at", "code", "name", "times_redeemed", "ends_at", "starts_at"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        return annotate_stats(Coupon.objects.all())

    def _fresh(self, pk):
        return annotate_stats(Coupon.objects.filter(pk=pk)).get()

    def perform_create(self, serializer):
        with transaction.atomic():
            coupon = serializer.save(created_by=self.request.user)
            audit(
                self.request.user,
                "coupon.create",
                coupon,
                summary=f"Created coupon {coupon.code}",
                changes=_snapshot(coupon),
                request=self.request,
            )
        serializer.instance = self._fresh(coupon.pk)

    def perform_update(self, serializer):
        with transaction.atomic():
            before = _snapshot(Coupon.objects.get(pk=serializer.instance.pk))
            was_active = serializer.instance.is_active
            coupon = serializer.save()
            after = _snapshot(coupon)
            diff = {k: [before[k], after[k]] for k in after if before.get(k) != after[k]}
            if diff:
                audit(
                    self.request.user,
                    "coupon.update",
                    coupon,
                    summary=f"Updated coupon {coupon.code}",
                    changes=diff,
                    request=self.request,
                )
            if coupon.is_active != was_active:
                audit(
                    self.request.user,
                    "coupon.activate" if coupon.is_active else "coupon.deactivate",
                    coupon,
                    summary=f"{'Activated' if coupon.is_active else 'Deactivated'} coupon {coupon.code}",
                    request=self.request,
                )
        serializer.instance = self._fresh(coupon.pk)

    def perform_destroy(self, instance):
        with transaction.atomic():
            locked = Coupon.objects.select_for_update().get(pk=instance.pk)
            if locked.redemptions.exists():
                raise DomainError(
                    "This coupon has been redeemed, so it cannot be deleted. Deactivate it instead.",
                    code="coupon_has_redemptions",
                    status_code=409,
                )
            audit(
                self.request.user,
                "coupon.delete",
                locked,
                summary=f"Deleted coupon {locked.code}",
                changes=_snapshot(locked),
                request=self.request,
            )
            locked.delete()
