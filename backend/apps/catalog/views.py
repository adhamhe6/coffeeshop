"""Public storefront catalog API: categories, products, collections, reviews, favorites."""

from __future__ import annotations

import copy

from django.db.models import Count, OuterRef, Prefetch, Q, Subquery
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.cache import cached
from apps.core.pagination import StandardPagination
from apps.inventory.services import apply_branch_availability

from . import services
from .filters import ProductFilter
from .models import Category, Collection, Favorite, ModifierGroup, ModifierOption, Product, Review, Tag
from .pagination import cached_page
from .search import normalize_query, search_products
from .selectors import resolve_branch, visible_products, with_card_data
from .serializers import (
    CategorySerializer,
    CollectionDetailSerializer,
    CollectionSerializer,
    FacetsSerializer,
    FavoriteAddSerializer,
    FavoriteIdsSerializer,
    FavoriteMergeResultSerializer,
    FavoriteMergeSerializer,
    OwnReviewSerializer,
    ProductCardSerializer,
    ProductDetailSerializer,
    ProductSuggestSerializer,
    ReviewCreateSerializer,
    ReviewEligibilitySerializer,
    ReviewSerializer,
    TagSerializer,
    plain,
)

BRANCH_PARAM = OpenApiParameter(
    "branch", str, description="Branch slug or id. Makes is_available / unavailable_reason branch-aware."
)


def _canonical_params(request, drop=("branch", "page", "page_size")):
    return sorted((k, tuple(request.query_params.getlist(k))) for k in request.query_params if k not in drop)


class CategoryListView(generics.ListAPIView):
    """Active categories with their number of purchasable products."""

    permission_classes = [AllowAny]
    serializer_class = CategorySerializer
    pagination_class = None
    filter_backends: list = []

    def list(self, request, *args, **kwargs):
        def build():
            qs = (
                Category.objects.filter(is_active=True)
                .annotate(product_count=Count("products", filter=Q(products__is_active=True)))
                .order_by("sort_order", "name")
            )
            return plain(CategorySerializer(qs, many=True).data)

        return Response(cached("catalog", ("categories",), build))


class ProductListView(generics.ListAPIView):
    """Menu / search results. Filters: q, category, collection, tag, type, featured, bestseller, seasonal, new, min_price, max_price, branch; ordering."""

    permission_classes = [AllowAny]
    serializer_class = ProductCardSerializer
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend]
    filterset_class = ProductFilter

    def get_queryset(self):
        return with_card_data(visible_products())

    def list(self, request, *args, **kwargs):
        branch = resolve_branch(request.query_params.get("branch"))
        queryset = self.filter_queryset(self.get_queryset())  # raises 400 on invalid filter values

        def build(offset, size):
            rows = list(queryset[offset : offset + size])
            return queryset.count(), plain(ProductCardSerializer(rows, many=True).data)

        page = cached_page(request, ("products", _canonical_params(request)), build)
        apply_branch_availability(page["results"], branch)
        return Response(page)


class ProductSuggestView(APIView):
    """Type-ahead: top 6 matches by relevance."""

    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[OpenApiParameter("q", str, required=True)],
        responses=ProductSuggestSerializer(many=True),
        operation_id="products_suggest_list",
    )
    def get(self, request):
        query = normalize_query(request.query_params.get("q"))
        if len(query) < 2:
            return Response([])

        def build():
            qs = search_products(visible_products().select_related("category"), query).order_by(
                "-search_rank", "-is_bestseller", "name", "id"
            )[:6]
            return plain(ProductSuggestSerializer(qs, many=True).data)

        return Response(cached("catalog", ("suggest", query.lower()), build))


class ProductFacetsView(generics.GenericAPIView):
    """Counts for a filter sidebar: categories, tags, types and the price range under the current filters.

    Accepts the same filters as the product list; each facet ignores its own dimension (so selecting a category still
    shows the counts of the other categories).
    """

    permission_classes = [AllowAny]
    serializer_class = FacetsSerializer
    queryset = Product.objects.none()  # schema generation only; the view builds its own querysets
    filter_backends = [DjangoFilterBackend]
    filterset_class = ProductFilter
    pagination_class = None

    @extend_schema(filters=True, responses=FacetsSerializer)
    def get(self, request):
        def narrowed(*drop):
            data = request.query_params.copy()
            for key in (*drop, "ordering", "branch", "page", "page_size"):
                data.pop(key, None)
            fs = ProductFilter(data, queryset=visible_products())
            if not fs.is_valid():
                raise ValidationError(fs.errors)
            return fs.qs.order_by()

        def build():
            by_category = (
                narrowed("category")
                .values("category__slug", "category__name", "category__sort_order")
                .annotate(count=Count("id"))
                .order_by("category__sort_order", "category__name")
            )
            by_tag = (
                Product.tags.through.objects.filter(product__in=narrowed("tag").values("id"))
                .values("tag__slug", "tag__name")
                .annotate(count=Count("id"))
                .order_by("tag__name")
            )
            by_type = narrowed("type").values("product_type").annotate(count=Count("id")).order_by("product_type")
            labels = dict(Product.Type.choices)
            payload = {
                "categories": [
                    {"slug": r["category__slug"], "name": r["category__name"], "count": r["count"]} for r in by_category
                ],
                "tags": [{"slug": r["tag__slug"], "name": r["tag__name"], "count": r["count"]} for r in by_tag],
                "types": [
                    {"value": r["product_type"], "label": labels[r["product_type"]], "count": r["count"]}
                    for r in by_type
                ],
                "price": ProductFilter.price_range(narrowed("min_price", "max_price")),
            }
            return plain(FacetsSerializer(payload).data)

        return Response(cached("catalog", ("facets", _canonical_params(request)), build))


class ProductDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = ProductDetailSerializer
    lookup_field = "slug"

    @extend_schema(parameters=[BRANCH_PARAM])
    def retrieve(self, request, *args, **kwargs):
        branch = resolve_branch(request.query_params.get("branch"))
        slug = kwargs["slug"]
        data = copy.deepcopy(cached("catalog", ("product", slug), lambda: self._build(slug)))
        apply_branch_availability([data, *data["related"]], branch)
        return Response(data)

    @staticmethod
    def _build(slug: str):
        product = get_object_or_404(
            with_card_data(visible_products()).prefetch_related("gallery"),
            slug=slug,
        )
        groups = (
            ModifierGroup.objects.filter(product_links__product=product, is_active=True)
            .order_by("product_links__sort_order", "product_links__id")
            .prefetch_related(Prefetch("options", queryset=ModifierOption.objects.filter(is_active=True)))
        )
        groups = [g for g in groups if g.options.all()]
        buckets = dict(
            Review.objects.filter(product=product, status=Review.Status.APPROVED)
            .order_by()
            .values_list("rating")
            .annotate(n=Count("id"))
        )
        total = sum(buckets.values())
        summary = {
            "average": round(sum(r * n for r, n in buckets.items()) / total, 1) if total else None,
            "count": total,
            "distribution": [{"rating": r, "count": buckets.get(r, 0)} for r in (5, 4, 3, 2, 1)],
        }
        related = with_card_data(visible_products().filter(category=product.category).exclude(pk=product.pk)).order_by(
            "-is_bestseller", "sort_order", "name", "id"
        )[:4]
        return plain(
            ProductDetailSerializer(
                product, context={"modifier_groups": groups, "review_summary": summary, "related": list(related)}
            ).data
        )


class CollectionListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = CollectionSerializer
    pagination_class = None
    filter_backends: list = []

    def list(self, request, *args, **kwargs):
        def build():
            qs = (
                Collection.objects.filter(is_active=True)
                .annotate(
                    product_count=Count(
                        "items",
                        filter=Q(items__product__is_active=True, items__product__category__is_active=True),
                    )
                )
                .order_by("sort_order", "name")
            )
            return plain(CollectionSerializer(qs, many=True).data)

        return Response(cached("catalog", ("collections",), build))


class CollectionDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = CollectionDetailSerializer
    lookup_field = "slug"

    @extend_schema(parameters=[BRANCH_PARAM])
    def retrieve(self, request, *args, **kwargs):
        branch = resolve_branch(request.query_params.get("branch"))
        slug = kwargs["slug"]

        def build():
            collection = get_object_or_404(Collection.objects.filter(is_active=True), slug=slug)
            products = list(
                with_card_data(visible_products().filter(collection_items__collection=collection)).order_by(
                    "collection_items__sort_order", "collection_items__id"
                )
            )
            collection.product_count = len(products)
            return plain(CollectionDetailSerializer(collection, context={"products": products}).data)

        data = copy.deepcopy(cached("catalog", ("collection", slug), build))
        apply_branch_availability(data["products"], branch)
        return Response(data)


class TagListView(generics.ListAPIView):
    """Tags in use on purchasable products (for filter chips)."""

    permission_classes = [AllowAny]
    pagination_class = None
    filter_backends: list = []
    serializer_class = TagSerializer

    def list(self, request, *args, **kwargs):
        def build():
            qs = Tag.objects.filter(
                id__in=Product.tags.through.objects.filter(product__in=visible_products().values("id")).values("tag_id")
            )
            return plain(self.get_serializer(qs, many=True).data)

        return Response(cached("catalog", ("tags",), build))


# ── reviews ──────────────────────────────────────────────────────────────────────────────────────────────────────────


class ProductReviewsView(generics.ListCreateAPIView):
    """GET approved reviews (paginated). POST (customers with a completed order containing the product) creates a PENDING review."""

    serializer_class = ReviewSerializer
    pagination_class = StandardPagination
    filter_backends: list = []

    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method == "POST" else [AllowAny()]

    def get_throttles(self):
        if self.request.method == "POST":
            self.throttle_scope = "review"
        return super().get_throttles()

    def _product(self):
        return get_object_or_404(visible_products(), slug=self.kwargs["slug"])

    def get_queryset(self):
        return (
            Review.objects.filter(product=self._product(), status=Review.Status.APPROVED)
            .select_related("user")
            .order_by("-created_at", "-id")
        )

    @extend_schema(request=ReviewCreateSerializer, responses={201: OwnReviewSerializer})
    def post(self, request, *args, **kwargs):
        product = self._product()
        serializer = ReviewCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review = services.create_review(request.user, product, **serializer.validated_data)
        return Response(OwnReviewSerializer(review).data, status=status.HTTP_201_CREATED)


class ReviewEligibilityView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=ReviewEligibilitySerializer)
    def get(self, request, slug):
        product = get_object_or_404(visible_products(), slug=slug)
        can, reason, _ = services.review_eligibility(request.user, product)
        return Response({"can_review": can, "reason": reason})


# ── favorites ────────────────────────────────────────────────────────────────────────────────────────────────────────


class FavoriteListCreateView(generics.ListCreateAPIView):
    """GET: the user's favorite products as full cards (newest first; `branch` makes availability branch-aware). POST {product_id}: idempotent add."""

    permission_classes = [IsAuthenticated]
    serializer_class = ProductCardSerializer
    pagination_class = StandardPagination
    filter_backends: list = []

    def get_queryset(self):
        stamp = Favorite.objects.filter(user=self.request.user, product=OuterRef("pk")).values("created_at")[:1]
        return (
            with_card_data(visible_products())
            .annotate(favorited_at=Subquery(stamp))
            .filter(favorited_at__isnull=False)
            .order_by("-favorited_at", "-id")
        )

    @extend_schema(parameters=[BRANCH_PARAM])
    def list(self, request, *args, **kwargs):
        branch = resolve_branch(request.query_params.get("branch"))
        page = self.paginate_queryset(self.get_queryset())
        data = [dict(item) for item in ProductCardSerializer(page, many=True).data]
        apply_branch_availability(data, branch)
        return self.get_paginated_response(data)

    @extend_schema(
        request=FavoriteAddSerializer,
        responses={
            200: FavoriteAddSerializer,
            201: FavoriteAddSerializer,
        },
    )
    def post(self, request, *args, **kwargs):
        serializer = FavoriteAddSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product_id = serializer.validated_data["product_id"]
        created = services.add_favorite(request.user, product_id)
        return Response({"product_id": product_id}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class FavoriteDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={204: None})
    def delete(self, request, product_id: int):
        Favorite.objects.filter(user=request.user, product_id=product_id).delete()  # idempotent
        return Response(status=status.HTTP_204_NO_CONTENT)


class FavoriteIdsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=FavoriteIdsSerializer)
    def get(self, request):
        ids = list(
            Favorite.objects.filter(user=request.user).order_by("-created_at").values_list("product_id", flat=True)
        )
        return Response({"ids": ids})


class FavoriteMergeView(APIView):
    """Merge guest favorites after sign-in. Invalid or inactive ids are ignored; at most 100 ids are considered."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=FavoriteMergeSerializer, responses=FavoriteMergeResultSerializer)
    def post(self, request):
        serializer = FavoriteMergeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        added = services.merge_favorites(request.user, serializer.validated_data["product_ids"])
        ids = list(
            Favorite.objects.filter(user=request.user).order_by("-created_at").values_list("product_id", flat=True)
        )
        return Response({"added": added, "ids": ids})
