"""Product selection (options + quantity) rules shared by quote, cart, checkout and reorder.

Pure helpers: they only read already-loaded model instances (prefetch `product.modifier_links__group` and
`product.category` to avoid queries when validating many lines).
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal

from apps.core.money import ZERO, q

MIN_QUANTITY = 1
MAX_QUANTITY = 50


@dataclass(frozen=True)
class Issue:
    """A problem or notice about a cart/line/checkout. `severity='error'` blocks checkout; 'warning' is informational."""

    code: str
    message: str
    severity: str = "error"
    item_id: int | None = None
    group: str | None = None
    status: int = 400
    data: dict = field(default_factory=dict, hash=False, compare=False)

    @property
    def is_blocking(self) -> bool:
        return self.severity == "error"

    def as_dict(self) -> dict:
        out: dict = {"code": self.code, "message": self.message, "severity": self.severity}
        if self.item_id is not None:
            out["item_id"] = self.item_id
        if self.group:
            out["group"] = self.group
        if self.data:
            out["data"] = dict(self.data)
        return out


def selection_signature(product_id: int, option_ids: Iterable[int]) -> str:
    """Stable identity of a line: sha1 over the product id and the sorted, de-duplicated option ids."""
    ids = ",".join(str(i) for i in sorted({int(i) for i in option_ids}))
    return hashlib.sha1(f"{int(product_id)}:{ids}".encode(), usedforsecurity=False).hexdigest()


def unit_price(product, options: Iterable) -> Decimal:
    """Base price plus option deltas, never below zero, rounded half-up."""
    total = Decimal(product.base_price) + sum((Decimal(o.price_delta) for o in options), Decimal("0"))
    return max(q(total), ZERO)


def active_groups(product) -> list:
    return [link.group for link in product.modifier_links.all() if link.group.is_active]


def product_issues(product) -> list[Issue]:
    category = product.category
    if not product.is_active or not category.is_active:
        return [
            Issue(
                "product_unavailable",
                f"{product.name} is no longer available.",
                status=409,
                data={"reason": "inactive"},
            )
        ]
    if product.is_sold_out:
        return [Issue("sold_out", f"{product.name} is sold out.", status=409, data={"reason": "sold_out"})]
    return []


def load_options(product, option_ids: Iterable[int]):
    """Resolve option ids to ModifierOption rows. Returns (options, issues) - unknown ids yield `invalid_option`."""
    from apps.catalog.models import ModifierOption

    wanted = sorted({int(i) for i in option_ids})
    if not wanted:
        return [], []
    found = {o.id: o for o in ModifierOption.objects.filter(id__in=wanted).select_related("group")}
    issues = [
        Issue("invalid_option", "One of the selected options does not exist.", data={"option_id": oid})
        for oid in wanted
        if oid not in found
    ]
    return [found[i] for i in wanted if i in found], issues


def check_selection(product, options: list, quantity) -> list[Issue]:
    """Validate a selection: quantity 1-50, options belong to the product's active groups and are available, and every
    group satisfies required / min_select / max_select. Does not look at stock (see inventory.services.availability)."""
    issues: list[Issue] = []
    if isinstance(quantity, bool) or not isinstance(quantity, int) or not (MIN_QUANTITY <= quantity <= MAX_QUANTITY):
        issues.append(Issue("invalid_quantity", f"Quantity must be between {MIN_QUANTITY} and {MAX_QUANTITY}."))
    issues.extend(product_issues(product))

    groups = {g.id: g for g in active_groups(product)}
    counts: dict[int, int] = defaultdict(int)
    for option in options:
        group = groups.get(option.group_id)
        if group is None:
            issues.append(
                Issue(
                    "invalid_option",
                    f"{option.name} is not available for {product.name}.",
                    data={"option_id": option.id},
                )
            )
            continue
        counts[group.id] += 1
        if not option.is_active or not option.is_available:
            issues.append(
                Issue(
                    "option_unavailable",
                    f"{option.name} is currently unavailable.",
                    group=group.display_name,
                    data={"option_id": option.id},
                )
            )
    for group in groups.values():
        n = counts[group.id]
        minimum = max(group.min_select, 1 if group.is_required else 0)
        maximum = 1 if group.selection_type == "SINGLE" else group.max_select
        if n < minimum:
            if n == 0:
                msg = f"Please choose an option for {group.display_name}."
                code = "required_group"
            else:
                msg = f"Choose at least {minimum} for {group.display_name}."
                code = "too_few_options"
            issues.append(Issue(code, msg, group=group.display_name))
        elif n > maximum:
            issues.append(
                Issue(
                    "too_many_options",
                    f"Choose at most {maximum} for {group.display_name}.",
                    group=group.display_name,
                )
            )
    return issues


def sort_options(options: Iterable) -> list:
    """Canonical display order: by group, then option."""
    return sorted(options, key=lambda o: (o.group.sort_order, o.group_id, o.sort_order, o.id))


def option_snapshot(options: Iterable) -> list[dict]:
    return [
        {"group": o.group.display_name, "name": o.name, "price_delta": q(o.price_delta)} for o in sort_options(options)
    ]
