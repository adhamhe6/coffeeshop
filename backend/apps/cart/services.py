"""Cart rules: who owns the cart (HttpOnly cookie / user), adding & editing lines, merging guest carts at login.

Identity: guests are identified by the `lantern_cart` cookie holding `Cart.token`; signed-in customers have exactly one
`Cart.user` cart. A cart is created lazily on the first add. Every mutation locks the cart row (`select_for_update`) so
concurrent requests cannot create duplicate lines or lose quantity.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound

from apps.core.errors import DomainError

from .models import Cart, CartItem
from .pricing import LineInput, PricedLine, price_lines
from .selection import MAX_QUANTITY, Issue, load_options, selection_signature, unit_price

log = logging.getLogger(__name__)

COOKIE_MAX_AGE = 60 * 60 * 24 * 90
MAX_LINES = 50


# ── identity ─────────────────────────────────────────────────────────────────────────────────────────────────────────


def cookie_name() -> str:
    return settings.CART_COOKIE_NAME


def parse_token(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def cookie_token(request) -> uuid.UUID | None:
    return parse_token(request.COOKIES.get(cookie_name()))


def set_cart_cookie(response, cart: Cart) -> None:
    response.set_cookie(
        cookie_name(),
        str(cart.token),
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=bool(getattr(settings, "SESSION_COOKIE_SECURE", False)),
        path="/",
    )


def clear_cart_cookie(response) -> None:
    response.delete_cookie(cookie_name(), path="/", samesite="Lax")


def get_cart(request, *, create: bool = False) -> Cart | None:
    """The requester's cart: the user's cart when signed in (after folding in any guest cart), else the cookie's cart."""
    user = request.user
    if user.is_authenticated:
        if cookie_token(request):
            merge_guest_cart(request, user)
        cart = Cart.objects.select_related("branch").filter(user=user).first()
        if cart is None and create:
            cart, _ = Cart.objects.get_or_create(user=user)
        return cart
    token = cookie_token(request)
    cart = Cart.objects.select_related("branch").filter(token=token, user__isnull=True).first() if token else None
    if cart is None and create:
        cart = Cart.objects.create()
    return cart


def get_cart_for_user(user) -> Cart:
    cart, _ = Cart.objects.select_related("branch").get_or_create(user=user)
    return cart


def touch(cart_id: int) -> None:
    Cart.objects.filter(pk=cart_id).update(updated_at=timezone.now())


def _lock(cart: Cart) -> Cart:
    return Cart.objects.select_for_update().get(pk=cart.pk)


# ── merge at login ───────────────────────────────────────────────────────────────────────────────────────────────────


def merge_guest_cart(request, user) -> None:
    """Fold the guest cart named by the `lantern_cart` cookie into `user`'s cart, then delete the guest cart.

    Quantities of identical lines (same signature) are summed and capped at 50; the newer note wins; lines that exist
    only in the guest cart move over. Idempotent (a second call finds no guest cart) and safe under concurrency (the
    guest cart row is locked, so exactly one of two simultaneous logins performs the merge).
    """
    token = cookie_token(request)
    if token is None or not getattr(user, "is_authenticated", False):
        return
    with transaction.atomic():
        guest = Cart.objects.select_for_update().filter(token=token, user__isnull=True).first()
        if guest is None:
            return
        try:
            with transaction.atomic():
                mine, _ = Cart.objects.get_or_create(user=user)
        except IntegrityError:  # pragma: no cover - lost a creation race, the row now exists
            mine = Cart.objects.get(user=user)
        mine = _lock(mine)
        existing = {i.signature: i for i in mine.items.select_for_update()}
        moved = merged = 0
        for item in guest.items.all():
            twin = existing.get(item.signature)
            if twin is None:
                item.cart = mine
                item.save(update_fields=["cart", "updated_at"])
                existing[item.signature] = item
                moved += 1
                continue
            twin.quantity = min(MAX_QUANTITY, twin.quantity + item.quantity)
            if item.updated_at > twin.updated_at and item.note:
                twin.note = item.note
                twin.unit_price_seen = item.unit_price_seen
            elif not twin.note and item.note:
                twin.note = item.note
            twin.save()
            merged += 1
        if mine.branch_id is None and guest.branch_id:
            mine.branch_id = guest.branch_id
            mine.save(update_fields=["branch", "updated_at"])
        else:
            touch(mine.pk)
        guest.delete()  # remaining (merged) guest items cascade
        log.info("guest cart merged user=%s moved=%s merged=%s", user.pk, moved, merged)


# ── loading & pricing ────────────────────────────────────────────────────────────────────────────────────────────────


def load_items(cart: Cart | None) -> list[CartItem]:
    if cart is None:
        return []
    return list(
        cart.items.select_related("product__category").prefetch_related(
            "options__group", "product__modifier_links__group"
        )
    )


def lines_from_items(items: Iterable[CartItem]) -> list[LineInput]:
    return [
        LineInput(
            product=i.product,
            options=tuple(i.options.all()),
            quantity=i.quantity,
            key=i.id,
            unit_price_seen=i.unit_price_seen,
            note=i.note,
        )
        for i in items
    ]


def get_product(product_id: int):
    from apps.catalog.models import Product

    product = (
        Product.objects.select_related("category")
        .prefetch_related("modifier_links__group")
        .filter(pk=product_id)
        .first()
    )
    if product is None:
        raise NotFound("Product not found.")
    return product


def evaluate_selection(product, option_ids: Iterable[int], quantity: int, *, branch=None):
    """Validate a selection exactly as the cart does. Returns (priced_line, blocking_issues)."""
    options, issues = load_options(product, option_ids)
    priced, line_issues = price_lines([LineInput(product, tuple(options), quantity)], branch=branch)
    blocking = [i for i in [*issues, *line_issues] if i.is_blocking]
    return priced[0], blocking


def raise_for_issues(issues: list[Issue]) -> None:
    if not issues:
        return
    first = issues[0]
    raise DomainError(
        first.message,
        code=first.code,
        status_code=first.status,
        fields={"option_ids": [first.message]} if first.code in _OPTION_CODES else None,
        extra={"errors": [i.as_dict() for i in issues]},
    )


_OPTION_CODES = {"required_group", "too_few_options", "too_many_options", "invalid_option", "option_unavailable"}


# ── mutations ────────────────────────────────────────────────────────────────────────────────────────────────────────


def add_item(cart: Cart, product, option_ids: Iterable[int], quantity: int, note: str = "") -> CartItem:
    """Add a line (or add to the identical existing one). Prices come from the server; `unit_price_seen` is stored."""
    option_ids = sorted({int(i) for i in option_ids})
    signature = selection_signature(product.id, option_ids)
    with transaction.atomic():
        cart = _lock(cart)
        existing = cart.items.filter(signature=signature).first()
        total = min(MAX_QUANTITY, (existing.quantity if existing else 0) + quantity)
        line, issues = evaluate_selection(product, option_ids, total if existing else quantity, branch=cart.branch)
        raise_for_issues(issues)
        if existing is None and cart.items.count() >= MAX_LINES:
            raise DomainError("Your cart is full. Remove an item to add another.", code="cart_full", status_code=409)
        if existing:
            existing.quantity = total
            if note:
                existing.note = note
            existing.save()
            item = existing
        else:
            item = CartItem.objects.create(
                cart=cart,
                product=product,
                signature=signature,
                quantity=quantity,
                note=note,
                unit_price_seen=line.unit_price,
            )
            item.options.set(list(line.options))
        touch(cart.pk)
        return item


def update_item(cart: Cart, item_id: int, *, quantity=None, option_ids=None, note=None) -> CartItem:
    """Change quantity / options / note. Changing options re-computes the signature and merges into an identical line."""
    with transaction.atomic():
        cart = _lock(cart)
        item = cart.items.select_related("product__category").filter(pk=item_id).first()
        if item is None:
            raise NotFound("Cart item not found.")
        product = get_product(item.product_id)
        current_ids = sorted(item.options.values_list("id", flat=True))
        new_ids = current_ids if option_ids is None else sorted({int(i) for i in option_ids})
        new_qty = item.quantity if quantity is None else quantity
        signature = selection_signature(product.id, new_ids)
        options_changed = signature != item.signature

        twin = cart.items.filter(signature=signature).exclude(pk=item.pk).first() if options_changed else None
        check_qty = min(MAX_QUANTITY, new_qty + twin.quantity) if twin else new_qty
        line, issues = evaluate_selection(product, new_ids, check_qty, branch=cart.branch)
        raise_for_issues(issues)

        if twin is not None:
            twin.quantity = check_qty
            if note:
                twin.note = note
            elif item.note and not twin.note:
                twin.note = item.note
            twin.save()
            item.delete()
            touch(cart.pk)
            return twin
        if options_changed:
            item.signature = signature
            item.options.set(list(line.options))
            item.unit_price_seen = line.unit_price
        item.quantity = new_qty
        if note is not None:
            item.note = note
        item.save()
        touch(cart.pk)
        return item


def remove_item(cart: Cart, item_id: int) -> None:
    with transaction.atomic():
        cart = _lock(cart)
        deleted, _ = cart.items.filter(pk=item_id).delete()
        if not deleted:
            raise NotFound("Cart item not found.")
        touch(cart.pk)


def clear_cart(cart: Cart) -> None:
    with transaction.atomic():
        cart = _lock(cart)
        cart.items.all().delete()
        touch(cart.pk)


def acknowledge_prices(cart: Cart) -> int:
    """Accept the current prices: `unit_price_seen` becomes today's unit price for every line. Returns lines changed."""
    changed = 0
    with transaction.atomic():
        cart = _lock(cart)
        for item in load_items(cart):
            current = unit_price(item.product, item.options.all())
            if item.unit_price_seen != current:
                item.unit_price_seen = current
                item.save(update_fields=["unit_price_seen", "updated_at"])
                changed += 1
        touch(cart.pk)
    return changed


def remember_branch(cart: Cart | None, branch) -> None:
    if cart is not None and branch is not None and cart.branch_id != branch.id:
        Cart.objects.filter(pk=cart.pk).update(branch=branch, updated_at=timezone.now())
        cart.branch = branch


def is_line_available(line: PricedLine) -> bool:
    return not any(
        i.code in ("product_unavailable", "sold_out", "branch_unavailable", "out_of_stock") for i in line.issues
    )


def stale_cutoffs(now=None):
    now = now or timezone.now()
    return now - timedelta(days=90), now - timedelta(days=7)
