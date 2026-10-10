import django_filters
from django.db.models import Max, Min
from django_filters.widgets import BooleanWidget

from .models import CollectionItem, Product
from .search import search_products

ORDERING_CHOICES = [
    ("menu", "Menu order (default)"),
    ("relevance", "Search relevance (default when q is given)"),
    ("price", "Price, low to high"),
    ("-price", "Price, high to low"),
    ("name", "Name A-Z"),
    ("-name", "Name Z-A"),
    ("popularity", "Bestsellers first"),
    ("newest", "Newest first"),
]
_ORDER_BY = {
    "menu": ["category__sort_order", "sort_order", "name", "id"],
    "price": ["base_price", "name", "id"],
    "-price": ["-base_price", "name", "id"],
    "name": ["name", "id"],
    "-name": ["-name", "id"],
    "popularity": ["-is_bestseller", "sort_order", "name", "id"],
    "newest": ["-created_at", "id"],
    "relevance": ["-search_rank", "-is_bestseller", "sort_order", "name", "id"],
}


class ProductFilter(django_filters.FilterSet):
    q = django_filters.CharFilter(method="filter_q", help_text="Search name, description, category, tags, allergens")
    category = django_filters.CharFilter(field_name="category__slug", help_text="Category slug")
    collection = django_filters.CharFilter(method="filter_collection", help_text="Collection slug")
    tag = django_filters.CharFilter(method="filter_tag", help_text="Tag slug")
    type = django_filters.ChoiceFilter(field_name="product_type", choices=Product.Type.choices)
    featured = django_filters.BooleanFilter(field_name="is_featured", widget=BooleanWidget())
    bestseller = django_filters.BooleanFilter(field_name="is_bestseller", widget=BooleanWidget())
    seasonal = django_filters.BooleanFilter(field_name="is_seasonal", widget=BooleanWidget())
    new = django_filters.BooleanFilter(field_name="is_new", widget=BooleanWidget())
    min_price = django_filters.NumberFilter(field_name="base_price", lookup_expr="gte")
    max_price = django_filters.NumberFilter(field_name="base_price", lookup_expr="lte")
    ids = django_filters.CharFilter(
        method="filter_ids", help_text="Comma-separated product ids (at most 100), e.g. to resolve saved favourites"
    )
    branch = django_filters.CharFilter(
        method="filter_noop", help_text="Branch slug or id: makes is_available/unavailable_reason branch-aware"
    )
    ordering = django_filters.ChoiceFilter(method="filter_noop", choices=ORDERING_CHOICES)

    class Meta:
        model = Product
        fields: list[str] = []

    def filter_noop(self, queryset, name, value):
        return queryset

    def filter_q(self, queryset, name, value):
        return search_products(queryset, value)

    def filter_ids(self, queryset, name, value):
        ids = [int(part) for part in value.split(",")[:100] if part.strip().isdigit()]
        return queryset.filter(id__in=ids)

    def filter_collection(self, queryset, name, value):
        return queryset.filter(
            id__in=CollectionItem.objects.filter(collection__slug=value, collection__is_active=True).values(
                "product_id"
            )
        )

    def filter_tag(self, queryset, name, value):
        return queryset.filter(id__in=Product.tags.through.objects.filter(tag__slug=value).values("product_id"))

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        ordering = self.form.cleaned_data.get("ordering") or ""
        searching = "search_rank" in queryset.query.annotations
        if ordering == "relevance" and not searching:
            ordering = "menu"
        if not ordering:
            ordering = "relevance" if searching else "menu"
        return queryset.order_by(*_ORDER_BY[ordering])

    # for the facets endpoint
    @classmethod
    def price_range(cls, queryset):
        agg = queryset.aggregate(lo=Min("base_price"), hi=Max("base_price"))
        return {"min": agg["lo"], "max": agg["hi"]}
