"""Staff API for the catalogue (capabilities: catalog.view / catalog.manage, reviews.moderate)."""

from __future__ import annotations

import hashlib
import logging

import django_filters
from django.db import IntegrityError, transaction
from django.db.models import Case, Count, Exists, F, IntegerField, OuterRef, Q, Subquery, Sum, When
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from django_filters.widgets import BooleanWidget
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.permissions import branch_scope
from apps.core.audit import audit
from apps.core.cache import bump
from apps.core.errors import DomainError
from apps.inventory.models import StockItem

from . import images
from .admin_serializers import (
    AdminCategorySerializer,
    AdminCollectionSerializer,
    AdminGallerySerializer,
    AdminModifierGroupSerializer,
    AdminModifierOptionSerializer,
    AdminProductListSerializer,
    AdminProductSerializer,
    AdminReviewSerializer,
    AdminTagSerializer,
    CollectionAddProductSerializer,
    CollectionProductIdsSerializer,
    set_collection_products,
    validate_defaults,
)
from .models import (
    Category,
    Collection,
    CollectionItem,
    ModifierGroup,
    ModifierOption,
    Product,
    ProductImage,
    Review,
    Tag,
)
from .staff import (
    CapabilityViewMixin,
    GalleryUploadSerializer,
    ImageResultSerializer,
    ImageUploadSerializer,
    ReorderSerializer,
    apply_order,
    diff,
    duplicate_error,
    snapshot,
)

log = logging.getLogger(__name__)

MAX_GALLERY_IMAGES = 10
PRODUCT_AUDIT_FIELDS = [
    "name",
    "slug",
    "sku",
    "category_id",
    "product_type",
    "stock_mode",
    "short_description",
    "base_price",
    "is_active",
    "is_featured",
    "is_bestseller",
    "is_seasonal",
    "is_new",
    "is_sold_out",
    "prep_minutes",
    "calories",
    "caffeine_mg",
    "allergens",
    "nutrition",
    "sort_order",
]


class StaffModelViewSet(CapabilityViewMixin, viewsets.ModelViewSet):
    """Base for catalogue admin viewsets: capability checks, cache invalidation, clean uniqueness conflicts."""

    read_capability = "catalog.view"
    write_capability = "catalog.manage"
    audit_prefix = ""
    audit_fields: list[str] = []

    def _snap(self, instance) -> dict:
        return snapshot(instance, self.audit_fields)

    def perform_create(self, serializer):
        try:
            with transaction.atomic():
                instance = serializer.save()
                audit(
                    self.request.user,
                    f"{self.audit_prefix}.create",
                    instance,
                    summary=f"Created {instance}",
                    changes={"new": self._snap(instance)},
                    request=self.request,
                )
        except IntegrityError:
            raise duplicate_error()
        bump("catalog")
        return instance

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = self.perform_create(serializer)
        return Response(
            self.get_serializer(self.get_queryset().get(pk=instance.pk)).data, status=status.HTTP_201_CREATED
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        before = self._snap(instance)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.check_update_allowed(instance, serializer.validated_data)
        try:
            with transaction.atomic():
                instance = serializer.save()
                self.after_update(instance, before)
        except IntegrityError:
            raise duplicate_error()
        bump("catalog")
        return Response(self.get_serializer(self.get_queryset().get(pk=instance.pk)).data)

    def check_update_allowed(self, instance, validated_data: dict) -> None:
        """Hook: raise to refuse an update (e.g. fields only global staff may change)."""

    def after_update(self, instance, before: dict):
        instance.refresh_from_db()
        changes = diff(before, self._snap(instance))
        if changes:
            audit(
                self.request.user,
                f"{self.audit_prefix}.update",
                instance,
                summary=f"Updated {instance}: {', '.join(sorted(changes))}"[:300],
                changes=changes,
                request=self.request,
            )

    def blocked_delete(self, instance) -> DomainError | None:
        return None

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        problem = self.blocked_delete(instance)
        if problem:
            raise problem
        label, snap, pk = str(instance), self._snap(instance), instance.pk
        try:
            with transaction.atomic():
                self.before_delete(instance)
                instance.delete()
                audit(
                    request.user,
                    f"{self.audit_prefix}.delete",
                    None,
                    resource_type=instance._meta.label,
                    resource_id=str(pk),
                    summary=f"Deleted {label}",
                    changes={"old": snap},
                    request=request,
                )
        except ProtectedError:
            raise DomainError("This item is still in use and cannot be deleted.", code="in_use", status_code=409)
        bump("catalog")
        return Response(status=status.HTTP_204_NO_CONTENT)

    def before_delete(self, instance):
        pass


class ImageActionsMixin:
    """`POST …/image/` (multipart `image`) and `DELETE …/image/` for models with an `image` ImageField."""

    image_audit_action = "image"

    @extend_schema(request={"multipart/form-data": ImageUploadSerializer}, responses=ImageResultSerializer)
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser], url_path="image")
    def upload_image(self, request, pk=None):
        obj = self.get_object()
        images.replace_image(obj, "image", request.FILES.get("image"), name=getattr(obj, "slug", "image"))
        audit(request.user, self.image_audit_action, obj, summary=f"Image replaced: {obj}", request=request)
        return Response({"image": obj.image.url if obj.image else None})

    @extend_schema(request=None, responses=ImageResultSerializer)
    @upload_image.mapping.delete
    def remove_image(self, request, pk=None):
        obj = self.get_object()
        images.remove_image(obj, "image")
        audit(request.user, self.image_audit_action, obj, summary=f"Image removed: {obj}", request=request)
        return Response({"image": None})


# ── products ─────────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminProductFilter(django_filters.FilterSet):
    q = django_filters.CharFilter(method="filter_q", help_text="Name, SKU or slug contains")
    category = django_filters.NumberFilter(field_name="category_id")
    active = django_filters.BooleanFilter(field_name="is_active", widget=BooleanWidget())
    type = django_filters.ChoiceFilter(field_name="product_type", choices=Product.Type.choices)
    stock_mode = django_filters.ChoiceFilter(choices=Product.StockMode.choices)
    is_featured = django_filters.BooleanFilter(widget=BooleanWidget())
    is_bestseller = django_filters.BooleanFilter(widget=BooleanWidget())
    is_seasonal = django_filters.BooleanFilter(widget=BooleanWidget())
    is_new = django_filters.BooleanFilter(widget=BooleanWidget())
    is_sold_out = django_filters.BooleanFilter(widget=BooleanWidget())
    low_stock = django_filters.BooleanFilter(
        method="filter_low_stock", widget=BooleanWidget(), help_text="STOCKED products at or below their threshold"
    )

    class Meta:
        model = Product
        fields: list[str] = []

    def filter_q(self, queryset, name, value):
        value = value.strip()
        if not value:
            return queryset
        return queryset.filter(Q(name__icontains=value) | Q(sku__icontains=value) | Q(slug__icontains=value))

    def filter_low_stock(self, queryset, name, value):
        return queryset.filter(low_stock=bool(value))


class AdminProductViewSet(ImageActionsMixin, StaffModelViewSet):
    audit_prefix = "product"
    image_audit_action = "product.image"
    audit_fields = PRODUCT_AUDIT_FIELDS
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = AdminProductFilter
    ordering_fields = [
        "name",
        "sku",
        "base_price",
        "sort_order",
        "created_at",
        "updated_at",
        "category__name",
        "stock_total",
    ]
    ordering = ["category__sort_order", "sort_order", "name"]

    def get_queryset(self):
        scope = branch_scope(self.request.user)
        stock = StockItem.objects.filter(product=OuterRef("pk"))
        if scope is not None:
            stock = stock.filter(branch_id__in=scope)
        qs = Product.objects.select_related("category").prefetch_related("tags", "gallery", "modifier_links__group")
        if self.action == "list":
            qs = qs.annotate(
                stock_total=Case(
                    When(
                        stock_mode=Product.StockMode.STOCKED,
                        then=Subquery(
                            stock.order_by().values("product").annotate(t=Sum("quantity")).values("t")[:1],
                            output_field=IntegerField(),
                        ),
                    ),
                    default=None,
                    output_field=IntegerField(),
                ),
                low_stock=Exists(stock.filter(quantity__lte=F("low_stock_threshold"), product__stock_mode="STOCKED")),
            )
        return qs

    def get_serializer_class(self):
        return AdminProductListSerializer if self.action == "list" else AdminProductSerializer

    def _snap(self, instance) -> dict:
        snap = snapshot(instance, self.audit_fields)
        snap["tags"] = sorted(t.name for t in instance.tags.all())
        snap["modifier_group_ids"] = list(
            instance.modifier_links.order_by("sort_order", "id").values_list("group_id", flat=True)
        )
        snap["description_hash"] = hashlib.sha1(instance.description.encode(), usedforsecurity=False).hexdigest()[:10]
        return snap

    def after_update(self, instance, before):
        super().after_update(instance, before)
        if str(before["base_price"]) != str(instance.base_price):
            audit(
                self.request.user,
                "product.price_change",
                instance,
                summary=f"Price of {instance.name}: {before['base_price']} → {instance.base_price}",
                changes={"sku": instance.sku, "old": str(before["base_price"]), "new": str(instance.base_price)},
                request=self.request,
            )
            log.info(
                "Price change %s: %s -> %s by %s",
                instance.sku,
                before["base_price"],
                instance.base_price,
                self.request.user.pk,
            )

    def blocked_delete(self, instance):
        from apps.orders.models import OrderItem

        count = OrderItem.objects.filter(product=instance).count()
        if count:
            return DomainError(
                f"{instance.name} appears on {count} order line(s) and cannot be deleted. "
                "Archive it instead - it disappears from the storefront but order history stays intact.",
                code="has_orders",
                status_code=409,
                extra={"order_lines": count},
            )
        return None

    def before_delete(self, instance):
        files = [(instance.image.storage, instance.image.name)] if instance.image else []
        files += [(g.image.storage, g.image.name) for g in instance.gallery.all() if g.image]

        def cleanup():
            for storage, name in files:
                try:
                    storage.delete(name)
                except Exception:  # noqa: BLE001
                    log.warning("Could not delete image %s", name)

        transaction.on_commit(cleanup)

    # ── archive ──
    @extend_schema(request=None, responses=AdminProductSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        return self._set_active(request, False)

    @extend_schema(request=None, responses=AdminProductSerializer)
    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        return self._set_active(request, True)

    def _set_active(self, request, active: bool):
        product = self.get_object()
        if product.is_active != active:
            product.is_active = active
            product.save(update_fields=["is_active", "updated_at"])
            audit(
                request.user,
                "product.archive" if not active else "product.unarchive",
                product,
                summary=f"{'Archived' if not active else 'Restored'} {product.name}",
                changes={"is_active": {"old": not active, "new": active}},
                request=request,
            )
        return Response(AdminProductSerializer(self.get_queryset().get(pk=product.pk)).data)

    # ── gallery ──
    @extend_schema(request={"multipart/form-data": GalleryUploadSerializer}, responses={201: AdminGallerySerializer})
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser], url_path="gallery")
    def add_gallery_image(self, request, pk=None):
        product = self.get_object()
        if product.gallery.count() >= MAX_GALLERY_IMAGES:
            raise DomainError(
                f"A product can have at most {MAX_GALLERY_IMAGES} gallery images.", code="gallery_full", status_code=409
            )
        content = images.process_image_upload(request.FILES.get("image"), name=f"{product.slug}-gallery")
        last = product.gallery.order_by("-sort_order").values_list("sort_order", flat=True).first()
        item = ProductImage(
            product=product, alt_text=request.data.get("alt_text", "")[:160], sort_order=(last or 0) + 1
        )
        item.image.save(content.name, content, save=False)
        item.save()
        audit(
            request.user,
            "product.gallery_add",
            product,
            summary=f"Gallery image added: {product.name}",
            request=request,
        )
        return Response(AdminGallerySerializer(item).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=AdminGallerySerializer, responses=AdminGallerySerializer)
    @action(detail=True, methods=["patch", "delete"], url_path=r"gallery/(?P<image_id>\d+)")
    def gallery_item(self, request, pk=None, image_id=None):
        product = self.get_object()
        item = get_object_or_404(product.gallery.all(), pk=image_id)
        if request.method == "DELETE":
            storage, name = item.image.storage, item.image.name
            item.delete()
            transaction.on_commit(lambda: storage.delete(name))
            audit(
                request.user,
                "product.gallery_remove",
                product,
                summary=f"Gallery image removed: {product.name}",
                request=request,
            )
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = AdminGallerySerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @extend_schema(request=ReorderSerializer, responses=AdminGallerySerializer(many=True))
    @action(detail=True, methods=["post"], url_path="gallery/reorder")
    def reorder_gallery(self, request, pk=None):
        product = self.get_object()
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ordered = apply_order(ProductImage, serializer.validated_data["ids"], queryset=product.gallery.all())
        return Response(AdminGallerySerializer(ordered, many=True).data)


# ── categories ───────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminCategoryViewSet(ImageActionsMixin, StaffModelViewSet):
    serializer_class = AdminCategorySerializer
    audit_prefix = "category"
    audit_fields = ["name", "slug", "description", "sort_order", "is_active", "is_featured"]
    image_audit_action = "category.image"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["is_active", "is_featured"]
    search_fields = ["name", "slug"]
    ordering_fields = ["name", "sort_order", "product_count"]
    ordering = ["sort_order", "name"]

    def get_queryset(self):
        return Category.objects.annotate(
            product_count=Count("products", distinct=True),
            active_product_count=Count("products", filter=Q(products__is_active=True), distinct=True),
        )

    def blocked_delete(self, instance):
        count = Product.objects.filter(category=instance).count()
        if count:
            return DomainError(
                f"{instance.name} still has {count} product(s). Move or archive them first, or deactivate the "
                "category to hide it from the storefront.",
                code="has_products",
                status_code=409,
                extra={"product_count": count},
            )
        return None

    @extend_schema(request=ReorderSerializer, responses=AdminCategorySerializer(many=True))
    @action(detail=False, methods=["post"])
    def reorder(self, request):
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            apply_order(Category, serializer.validated_data["ids"])
            audit(
                request.user,
                "category.reorder",
                None,
                resource_type="catalog.Category",
                resource_id="*",
                summary="Categories reordered",
                changes={"ids": serializer.validated_data["ids"]},
                request=request,
            )
        return Response(AdminCategorySerializer(self.get_queryset().order_by("sort_order", "name"), many=True).data)


# ── tags ─────────────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminTagViewSet(StaffModelViewSet):
    serializer_class = AdminTagSerializer
    audit_prefix = "tag"
    audit_fields = ["name", "slug"]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "slug"]
    ordering_fields = ["name", "product_count"]
    ordering = ["name"]

    def get_queryset(self):
        return Tag.objects.annotate(product_count=Count("products", distinct=True))


# ── modifier groups & options ────────────────────────────────────────────────────────────────────────────────────────


class AdminModifierGroupViewSet(StaffModelViewSet):
    serializer_class = AdminModifierGroupSerializer
    audit_prefix = "modifier_group"
    audit_fields = [
        "name",
        "display_name",
        "selection_type",
        "is_required",
        "min_select",
        "max_select",
        "sort_order",
        "is_active",
    ]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["is_active", "selection_type", "is_required"]
    search_fields = ["name", "display_name"]
    ordering_fields = ["name", "sort_order", "product_count"]
    ordering = ["sort_order", "name"]

    def get_queryset(self):
        return ModifierGroup.objects.annotate(product_count=Count("product_links", distinct=True)).prefetch_related(
            "options"
        )

    def after_update(self, instance, before):
        validate_defaults(instance)
        super().after_update(instance, before)

    def blocked_delete(self, instance):
        from apps.orders.models import OrderItemOption

        attached = instance.product_links.count()
        ordered = OrderItemOption.objects.filter(option__group=instance).exists()
        if attached or ordered:
            return DomainError(
                "This group is attached to products or appears in order history. Detach it from its products "
                "or deactivate it instead of deleting.",
                code="in_use",
                status_code=409,
                extra={"product_count": attached, "in_order_history": ordered},
            )
        return None

    @extend_schema(
        request=AdminModifierOptionSerializer,
        responses={200: AdminModifierOptionSerializer(many=True), 201: AdminModifierOptionSerializer},
    )
    @action(detail=True, methods=["get", "post"], url_path="options")
    def options(self, request, pk=None):
        group = self.get_object()
        if request.method == "GET":
            return Response(AdminModifierOptionSerializer(group.options.all(), many=True).data)
        serializer = AdminModifierOptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        self._check_unique_name(group, data["name"])
        with transaction.atomic():
            if "sort_order" not in data:
                last = group.options.order_by("-sort_order").values_list("sort_order", flat=True).first()
                data["sort_order"] = (last + 1) if last is not None else 0
            option = ModifierOption.objects.create(group=group, **data)
            self._after_option_change(group, option)
            audit(
                request.user,
                "modifier_option.create",
                option,
                summary=f"Option '{option.name}' added to {group.name}",
                changes={"group": group.name, "name": option.name, "price_delta": str(option.price_delta)},
                request=request,
            )
        return Response(AdminModifierOptionSerializer(option).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=AdminModifierOptionSerializer, responses=AdminModifierOptionSerializer)
    @action(detail=True, methods=["patch", "delete"], url_path=r"options/(?P<option_id>\d+)")
    def option_detail(self, request, pk=None, option_id=None):
        group = self.get_object()
        option = get_object_or_404(group.options.all(), pk=option_id)
        if request.method == "DELETE":
            from apps.orders.models import OrderItemOption

            if OrderItemOption.objects.filter(option=option).exists():
                raise DomainError(
                    "This option appears in order history. Mark it inactive instead of deleting it.",
                    code="in_use",
                    status_code=409,
                )
            with transaction.atomic():
                label = option.name
                option.delete()
                audit(
                    request.user,
                    "modifier_option.delete",
                    None,
                    resource_type="catalog.ModifierOption",
                    resource_id=str(option_id),
                    summary=f"Option '{label}' deleted from {group.name}",
                    request=request,
                )
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = AdminModifierOptionSerializer(option, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        if "name" in serializer.validated_data:
            self._check_unique_name(group, serializer.validated_data["name"], exclude=option.pk)
        before = {f: jsonable_value(getattr(option, f)) for f in serializer.fields if f != "id"}
        with transaction.atomic():
            option = serializer.save()
            self._after_option_change(group, option)
            after = {f: jsonable_value(getattr(option, f)) for f in before}
            changes = diff(before, after)
            if changes:
                audit(
                    request.user,
                    "modifier_option.update",
                    option,
                    summary=f"Option '{option.name}' of {group.name} updated: {', '.join(sorted(changes))}"[:300],
                    changes=changes,
                    request=request,
                )
        return Response(AdminModifierOptionSerializer(option).data)

    @extend_schema(request=ReorderSerializer, responses=AdminModifierOptionSerializer(many=True))
    @action(detail=True, methods=["post"], url_path="options/reorder")
    def reorder_options(self, request, pk=None):
        group = self.get_object()
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ordered = apply_order(ModifierOption, serializer.validated_data["ids"], queryset=group.options.all())
        audit(
            request.user,
            "modifier_group.reorder_options",
            group,
            summary=f"Options of {group.name} reordered",
            request=request,
        )
        return Response(AdminModifierOptionSerializer(ordered, many=True).data)

    @staticmethod
    def _check_unique_name(group, name, exclude=None):
        clash = group.options.filter(name__iexact=name)
        if exclude:
            clash = clash.exclude(pk=exclude)
        if clash.exists():
            raise DomainError(
                "This group already has an option with that name.",
                code="validation_error",
                fields={"name": ["This group already has an option with that name."]},
            )

    @staticmethod
    def _after_option_change(group, option):
        """Keep default selections consistent: SINGLE groups have at most one default; MULTIPLE at most max_select."""
        if option.is_default and group.selection_type == ModifierGroup.Selection.SINGLE:
            group.options.exclude(pk=option.pk).filter(is_default=True).update(is_default=False)
            bump("catalog")
        validate_defaults(group)


def jsonable_value(value):
    return str(value) if hasattr(value, "quantize") else value


# ── collections ──────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminCollectionViewSet(ImageActionsMixin, StaffModelViewSet):
    serializer_class = AdminCollectionSerializer
    audit_prefix = "collection"
    audit_fields = ["name", "slug", "description", "sort_order", "is_active", "is_featured"]
    image_audit_action = "collection.image"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["is_active", "is_featured"]
    search_fields = ["name", "slug"]
    ordering_fields = ["name", "sort_order", "product_count"]
    ordering = ["sort_order", "name"]

    def get_queryset(self):
        return Collection.objects.annotate(product_count=Count("items", distinct=True)).prefetch_related(
            "items__product"
        )

    def _snap(self, instance) -> dict:
        snap = snapshot(instance, self.audit_fields)
        snap["product_ids"] = list(instance.items.order_by("sort_order", "id").values_list("product_id", flat=True))
        return snap

    @extend_schema(request=CollectionProductIdsSerializer, responses=AdminCollectionSerializer)
    @action(detail=True, methods=["put"], url_path="products")
    def replace_products(self, request, pk=None):
        collection = self.get_object()
        serializer = AdminCollectionSerializer(
            collection, data={"product_ids": request.data.get("product_ids")}, partial=True
        )
        serializer.is_valid(raise_exception=True)
        before = self._snap(collection)
        with transaction.atomic():
            set_collection_products(collection, serializer.validated_data["product_ids"])
            changes = diff(before, self._snap(collection))
            if changes:
                audit(
                    request.user,
                    "collection.products",
                    collection,
                    summary=f"Products of {collection.name} updated",
                    changes=changes,
                    request=request,
                )
        bump("catalog")
        return Response(AdminCollectionSerializer(self.get_queryset().get(pk=collection.pk)).data)

    @extend_schema(request=CollectionAddProductSerializer, responses=AdminCollectionSerializer)
    @replace_products.mapping.post
    def add_product(self, request, pk=None):
        collection = self.get_object()
        serializer = CollectionAddProductSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = get_object_or_404(Product, pk=serializer.validated_data["product_id"])
        with transaction.atomic():
            last = collection.items.order_by("-sort_order").values_list("sort_order", flat=True).first()
            _, created = CollectionItem.objects.get_or_create(
                collection=collection, product=product, defaults={"sort_order": (last + 1) if last is not None else 0}
            )
            if created:
                audit(
                    request.user,
                    "collection.products",
                    collection,
                    summary=f"{product.name} added to {collection.name}",
                    changes={"added": product.sku},
                    request=request,
                )
        return Response(AdminCollectionSerializer(self.get_queryset().get(pk=collection.pk)).data)

    @extend_schema(request=None, responses=AdminCollectionSerializer)
    @action(detail=True, methods=["delete"], url_path=r"products/(?P<product_id>\d+)")
    def remove_product(self, request, pk=None, product_id=None):
        collection = self.get_object()
        with transaction.atomic():
            deleted, _ = CollectionItem.objects.filter(collection=collection, product_id=product_id).delete()
            if deleted:
                audit(
                    request.user,
                    "collection.products",
                    collection,
                    summary=f"Product {product_id} removed from {collection.name}",
                    changes={"removed": int(product_id)},
                    request=request,
                )
        return Response(AdminCollectionSerializer(self.get_queryset().get(pk=collection.pk)).data)

    @extend_schema(request=ReorderSerializer, responses=AdminCollectionSerializer(many=True))
    @action(detail=False, methods=["post"])
    def reorder(self, request):
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        apply_order(Collection, serializer.validated_data["ids"])
        audit(
            request.user,
            "collection.reorder",
            None,
            resource_type="catalog.Collection",
            resource_id="*",
            summary="Collections reordered",
            changes={"ids": serializer.validated_data["ids"]},
            request=request,
        )
        return Response(AdminCollectionSerializer(self.get_queryset().order_by("sort_order", "name"), many=True).data)


# ── reviews ──────────────────────────────────────────────────────────────────────────────────────────────────────────


class AdminReviewFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=Review.Status.choices)
    product = django_filters.NumberFilter(field_name="product_id")
    is_demo = django_filters.BooleanFilter(widget=BooleanWidget())
    rating = django_filters.NumberFilter()
    q = django_filters.CharFilter(method="filter_q", help_text="Title, body or customer email contains")

    class Meta:
        model = Review
        fields: list[str] = []

    def filter_q(self, queryset, name, value):
        value = value.strip()
        return (
            queryset.filter(Q(title__icontains=value) | Q(body__icontains=value) | Q(user__email__icontains=value))
            if value
            else queryset
        )


class AdminReviewViewSet(
    CapabilityViewMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    read_capability = "reviews.moderate"
    write_capability = "reviews.moderate"
    serializer_class = AdminReviewSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = AdminReviewFilter
    ordering_fields = ["created_at", "rating", "status"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        return Review.objects.select_related("product", "user", "order", "moderated_by")

    @extend_schema(request=None, responses=AdminReviewSerializer)
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._moderate(request, Review.Status.APPROVED)

    @extend_schema(request=None, responses=AdminReviewSerializer)
    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._moderate(request, Review.Status.REJECTED)

    def _moderate(self, request, new_status):
        review = self.get_object()
        if review.status != new_status:
            old = review.status
            with transaction.atomic():
                review.status = new_status
                review.moderated_by = request.user
                review.moderated_at = timezone.now()
                review.save(update_fields=["status", "moderated_by", "moderated_at"])
                audit(
                    request.user,
                    f"review.{'approve' if new_status == Review.Status.APPROVED else 'reject'}",
                    review,
                    summary=f"Review of {review.product.name} {new_status.lower()}",
                    changes={
                        "status": {"old": old, "new": new_status},
                        "product": review.product.sku,
                        "is_demo": review.is_demo,
                    },
                    request=request,
                )
        return Response(AdminReviewSerializer(review).data)
