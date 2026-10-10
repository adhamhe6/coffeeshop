"""Read-side queries for the storefront: visibility rules, card annotations, branch resolution."""

from __future__ import annotations

from django.db.models import Avg, Count, Exists, FloatField, IntegerField, OuterRef, Prefetch, Subquery, Value
from django.db.models.functions import Coalesce
from rest_framework.exceptions import ValidationError

from apps.branches.models import Branch

from .models import Product, ProductModifierGroup, Review, Tag


def visible_products():
    """Only active products in active categories are ever shown (or purchasable)."""
    return Product.objects.filter(is_active=True, category__is_active=True)


def with_card_data(queryset):
    """Annotate rating/has_options and prefetch tags + category so a card list costs a constant number of queries."""
    approved = Review.objects.filter(product=OuterRef("pk"), status=Review.Status.APPROVED).order_by()
    return (
        queryset.select_related("category")
        .prefetch_related(Prefetch("tags", queryset=Tag.objects.order_by("name")))
        .annotate(
            rating_avg=Subquery(
                approved.values("product").annotate(v=Avg("rating")).values("v")[:1], output_field=FloatField()
            ),
            rating_count=Coalesce(
                Subquery(
                    approved.values("product").annotate(v=Count("pk")).values("v")[:1], output_field=IntegerField()
                ),
                Value(0),
            ),
            has_options=Exists(
                ProductModifierGroup.objects.filter(
                    product=OuterRef("pk"), group__is_active=True, group__options__is_active=True
                )
            ),
        )
    )


def resolve_branch(value: str | None) -> Branch | None:
    """`branch` query param: slug or numeric id of an active branch. Unknown values are a 400, not silently ignored."""
    if not value:
        return None
    qs = Branch.objects.filter(is_active=True)
    branch = qs.filter(pk=int(value)).first() if value.isdigit() else None
    branch = branch or qs.filter(slug=value).first()
    if branch is None:
        raise ValidationError({"branch": ["Unknown branch."]})
    return branch
