"""Catalog business rules: slugs, review eligibility/creation, favorites."""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.utils.text import slugify

from apps.core.errors import DomainError
from apps.core.models import StoreSettings

from .models import Favorite, Product, Review

log = logging.getLogger(__name__)

MAX_FAVORITES_MERGE = 100


def unique_slug(model, text: str, *, exclude_pk=None, field: str = "slug", fallback: str = "item") -> str:
    """slugify(text), suffixed -2, -3 … until unique for `model`."""
    max_length = model._meta.get_field(field).max_length or 50
    base = (slugify(text) or fallback)[: max_length - 6].strip("-") or fallback
    slug, n = base, 1
    while model.objects.filter(**{field: slug}).exclude(pk=exclude_pk).exists():
        n += 1
        slug = f"{base}-{n}"
    return slug


# ── reviews ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def _completed_order_for(user, product):
    from apps.orders.models import Order, OrderItem

    return (
        Order.objects.filter(
            customer=user,
            status=Order.Status.COMPLETED,
            id__in=OrderItem.objects.filter(product=product).values("order_id"),
        )
        .order_by("-placed_at", "-id")
        .first()
    )


def review_eligibility(user, product) -> tuple[bool, str | None, object | None]:
    """(can_review, reason, order). Reasons: login_required|reviews_disabled|already_reviewed|not_purchased."""
    if not getattr(user, "is_authenticated", False):
        return False, "login_required", None
    if not StoreSettings.load().enable_reviews:
        return False, "reviews_disabled", None
    if Review.objects.filter(product=product, user=user).exists():
        return False, "already_reviewed", None
    order = _completed_order_for(user, product)
    if order is None:
        return False, "not_purchased", None
    return True, None, order


_ELIGIBILITY_ERRORS = {
    "reviews_disabled": ("Reviews are currently turned off.", 403),
    "already_reviewed": ("You have already reviewed this product.", 409),
    "not_purchased": ("Only customers who have received this product can review it.", 403),
}


def create_review(user, product, *, rating: int, title: str = "", body: str = "") -> Review:
    """Create a PENDING review (moderated before it is shown). Raises DomainError with the eligibility reason."""
    ok, reason, order = review_eligibility(user, product)
    if not ok:
        message, status = _ELIGIBILITY_ERRORS.get(reason, ("You cannot review this product.", 403))
        raise DomainError(message, code=reason or "not_eligible", status_code=status)
    try:
        with transaction.atomic():
            review = Review.objects.create(
                product=product,
                user=user,
                order=order,
                rating=rating,
                title=title.strip(),
                body=body.strip(),
                status=Review.Status.PENDING,
            )
    except IntegrityError:  # two simultaneous submissions: the unique constraint is the arbiter
        raise DomainError(*_ELIGIBILITY_ERRORS["already_reviewed"][:1], code="already_reviewed", status_code=409)
    log.info("Review %s submitted for product %s by user %s (pending)", review.pk, product.pk, user.pk)
    return review


# ── favorites ────────────────────────────────────────────────────────────────────────────────────────────────────────


def add_favorite(user, product_id: int) -> bool:
    """Idempotently favorite a visible product. Returns True when newly added. Unknown/inactive -> DomainError 404."""
    from .selectors import visible_products

    if not visible_products().filter(pk=product_id).exists():
        raise DomainError("Product not found.", code="not_found", status_code=404)
    _, created = Favorite.objects.get_or_create(user=user, product_id=product_id)
    return created


def merge_favorites(user, product_ids) -> int:
    """Add guest favorites after sign-in. Invalid/inactive ids are ignored, at most 100 considered. Returns # added."""
    from .selectors import visible_products

    wanted = list(dict.fromkeys(product_ids))[:MAX_FAVORITES_MERGE]
    valid = list(visible_products().filter(pk__in=wanted).values_list("pk", flat=True))
    existing = set(Favorite.objects.filter(user=user, product_id__in=valid).values_list("product_id", flat=True))
    new = [pid for pid in wanted if pid in valid and pid not in existing]
    Favorite.objects.bulk_create([Favorite(user=user, product_id=pid) for pid in new], ignore_conflicts=True)
    return len(new)


def product_is_visible(product: Product) -> bool:
    return product.is_active and product.category.is_active
