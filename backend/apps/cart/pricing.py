"""The single, authoritative pricing implementation (docs/implementation-plan.md section 5).

    unit      = base_price + sum(option.price_delta)                       (never below 0)
    line      = unit x quantity
    subtotal  = sum(line)
    discount  = coupon OR automatic promotion, on eligible lines only, capped at the eligible amount / max_discount
    delivery  = zone fee (free over threshold; 0 for pickup)
    tax       = tax_rate % of (subtotal - discount); the delivery fee is not taxed
                exclusive: total = subtotal - discount + delivery + tax
                inclusive: tax is *extracted* from (subtotal - discount), total = subtotal - discount + delivery
    every component is rounded half-up to cents.

Nothing price-like is ever read from a request: callers pass loaded model instances only.

Coupon policy (documented because it is a product decision):
  * A typed code replaces automatic promotions - discounts never stack.
  * When no code is typed, every eligible automatic promotion is evaluated and the single best discount wins
    (ties go to the lowest id).
  * A typed code that is rejected is reported in `coupon_error` and the automatic promotions are still considered,
    so a typo does not cost the customer a promotion they would otherwise get. Checkout refuses such a request.
  * `min_order_total` is compared with the eligible subtotal (the lines the coupon applies to).
  * Delivery minimum / free-over thresholds are compared with the pre-discount subtotal.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from decimal import Decimal

from django.utils import timezone

from apps.core.errors import DomainError
from apps.core.money import ZERO, q
from apps.promotions.models import Coupon
from apps.promotions.services import (
    automatic_coupons,
    customer_redemption_count,
    find_coupon,
    has_previous_orders,
    normalize_code,
)

from .selection import Issue, check_selection, sort_options, unit_price

log = logging.getLogger(__name__)

DELIVERY = "DELIVERY"
MAX_PRICED_QUANTITY = 1_000_000  # far above the 1-50 rule; only stops decimal overflow on hostile input
HUNDRED = Decimal("100")


# ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class LineInput:
    """One line to price. `key` is echoed back (cart item id, or any identifier)."""

    product: object
    options: tuple = ()
    quantity: int = 1
    key: object = None
    unit_price_seen: Decimal | None = None
    note: str = ""


@dataclass(frozen=True)
class PricedLine:
    key: object
    product: object
    options: tuple
    quantity: int
    base_price: Decimal
    unit_price: Decimal
    line_total: Decimal
    discount: Decimal
    issues: tuple[Issue, ...] = ()
    unit_price_seen: Decimal | None = None
    note: str = ""

    @property
    def price_changed(self) -> dict | None:
        if self.unit_price_seen is not None and q(self.unit_price_seen) != self.unit_price:
            return {"was": q(self.unit_price_seen), "now": self.unit_price}
        return None


@dataclass(frozen=True)
class DeliveryInfo:
    fee: Decimal
    min_order_total: Decimal
    eta_minutes: int


@dataclass(frozen=True)
class PriceBreakdown:
    lines: tuple[PricedLine, ...]
    subtotal: Decimal
    discount_total: Decimal
    delivery_fee: Decimal
    tax_total: Decimal
    total: Decimal
    tax_rate: Decimal
    prices_include_tax: bool
    currency: str
    applied_coupon: Coupon | None
    coupon_error: Issue | None
    delivery: DeliveryInfo | None
    issues: tuple[Issue, ...] = field(default=())

    @property
    def blocking_issues(self) -> list[Issue]:
        return [i for i in self.issues if i.is_blocking]

    @property
    def item_count(self) -> int:
        return sum(line.quantity for line in self.lines)


class CouponRejected(Exception):
    def __init__(self, code: str, message: str, **data):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def as_issue(self) -> Issue:
        return Issue(self.code, self.message, data=self.data)


@dataclass(frozen=True)
class CouponEvaluation:
    coupon: Coupon
    discount: Decimal
    allocations: dict[int, Decimal]  # index of line -> discount


# ── pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────


def distribute(amount: Decimal, weights: Sequence[Decimal]) -> list[Decimal]:
    """Split `amount` over `weights` proportionally in whole cents (largest remainder) so the parts sum exactly."""
    cents = int((q(amount) * 100).to_integral_value())
    w = [int((q(x) * 100).to_integral_value()) for x in weights]
    total_w = sum(w)
    if cents <= 0 or total_w <= 0:
        return [ZERO for _ in weights]
    base = [cents * x // total_w for x in w]
    remainders = [cents * x % total_w for x in w]
    leftover = cents - sum(base)
    order = sorted(range(len(w)), key=lambda i: (-remainders[i], i))
    for i in order[:leftover]:
        base[i] += 1
    return [Decimal(b) / 100 for b in base]


def compute_tax(taxable: Decimal, rate: Decimal, *, inclusive: bool) -> Decimal:
    """Tax on `taxable` (amount after discount). Inclusive prices: the tax portion extracted from the amount."""
    if rate <= 0 or taxable <= 0:
        return ZERO
    if inclusive:
        return q(taxable * rate / (HUNDRED + rate))
    return q(taxable * rate / HUNDRED)


def raw_discount(coupon: Coupon, eligible_subtotal: Decimal) -> Decimal:
    """Discount a coupon is worth on `eligible_subtotal`: percent/fixed, `max_discount` cap, never above the amount."""
    if coupon.discount_type == Coupon.DiscountType.PERCENT:
        value = q(eligible_subtotal * min(Decimal(coupon.value), HUNDRED) / HUNDRED)
    else:
        value = q(coupon.value)
    if coupon.max_discount is not None:
        value = min(value, q(coupon.max_discount))
    return max(min(value, eligible_subtotal), ZERO)


def _eligible_indexes(coupon: Coupon, lines: Sequence[PricedLine]) -> list[int]:
    if coupon.applies_to == Coupon.AppliesTo.CATEGORIES:
        ids = {c.id for c in coupon.categories.all()}
        return [i for i, ln in enumerate(lines) if ln.product.category_id in ids]
    if coupon.applies_to == Coupon.AppliesTo.PRODUCTS:
        ids = {p.id for p in coupon.products.all()}
        return [i for i, ln in enumerate(lines) if ln.product.id in ids]
    return list(range(len(lines)))


def evaluate_coupon(coupon: Coupon, lines: Sequence[PricedLine], *, user=None, now=None) -> CouponEvaluation:
    """Check every eligibility rule and compute the discount. Raises `CouponRejected(code, message)`.

    Codes: not_found (unknown/inactive), not_started, expired, exhausted, login_required, first_order_only,
    per_customer_limit, not_eligible, min_order_not_met.
    """
    now = now or timezone.now()
    if not coupon.is_active:
        raise CouponRejected("not_found", "That promo code is not valid.")
    if coupon.starts_at and coupon.starts_at > now:
        raise CouponRejected("not_started", "That promo code is not active yet.")
    if coupon.ends_at and coupon.ends_at <= now:
        raise CouponRejected("expired", "That promo code has expired.")
    if coupon.usage_limit is not None and coupon.times_redeemed >= coupon.usage_limit:
        raise CouponRejected("exhausted", "That promo code has been fully redeemed.")
    authenticated = bool(user is not None and getattr(user, "is_authenticated", False))
    if coupon.first_order_only:
        if not authenticated:
            raise CouponRejected("login_required", "Sign in to use this promo code.")
        if has_previous_orders(user):
            raise CouponRejected("first_order_only", "That promo code is only valid on your first order.")
    if coupon.per_customer_limit is not None:
        if not authenticated:
            raise CouponRejected("login_required", "Sign in to use this promo code.")
        if customer_redemption_count(coupon, user) >= coupon.per_customer_limit:
            raise CouponRejected(
                "per_customer_limit", "You have already used this promo code the maximum number of times."
            )

    eligible = _eligible_indexes(coupon, lines)
    eligible_subtotal = sum((lines[i].line_total for i in eligible), ZERO)
    if not eligible or eligible_subtotal <= 0:
        raise CouponRejected("not_eligible", "That promo code does not apply to the items in your cart.")
    minimum = q(coupon.min_order_total)
    if eligible_subtotal < minimum:
        raise CouponRejected(
            "min_order_not_met",
            f"Spend {minimum} on eligible items to use this promo code.",
            min_order_total=str(minimum),
            eligible_subtotal=str(eligible_subtotal),
        )
    discount = raw_discount(coupon, eligible_subtotal)
    if discount <= 0:
        raise CouponRejected("not_eligible", "That promo code does not apply to the items in your cart.")
    parts = distribute(discount, [lines[i].line_total for i in eligible])
    return CouponEvaluation(coupon, discount, dict(zip(eligible, parts, strict=True)))


# ── line pricing ─────────────────────────────────────────────────────────────────────────────────────────────────────


def _availability_issues(lines: Sequence[LineInput], priced: list[PricedLine], branch) -> dict[int, list[Issue]]:
    """Stock / branch availability, with quantities of the same product across lines added together."""
    from apps.inventory.services import availability

    totals: dict[int, int] = defaultdict(int)
    for ln in lines:
        totals[ln.product.id] += ln.quantity if isinstance(ln.quantity, int) else 0
    verdict: dict[int, tuple[bool, str | None]] = {}
    out: dict[int, list[Issue]] = defaultdict(list)
    for index, ln in enumerate(lines):
        pid = ln.product.id
        if pid not in verdict:
            verdict[pid] = availability(ln.product, branch, max(totals[pid], 1))
        ok, reason = verdict[pid]
        if not ok and reason in ("branch_unavailable", "out_of_stock"):
            message = (
                f"{ln.product.name} is not available at this location."
                if reason == "branch_unavailable"
                else f"Not enough stock of {ln.product.name} at this location."
            )
            out[index].append(Issue(reason, message, item_id=priced[index].key, status=409, data={"product_id": pid}))
    return out


def price_lines(lines: Sequence[LineInput], *, branch=None, check_availability: bool = True):
    """Price and validate lines without coupons, delivery or tax. Returns (priced_lines, issues)."""
    priced: list[PricedLine] = []
    for ln in lines:
        unit = unit_price(ln.product, ln.options)
        issues = tuple(_with_item(i, ln.key) for i in check_selection(ln.product, list(ln.options), ln.quantity))
        qty = ln.quantity if isinstance(ln.quantity, int) and not isinstance(ln.quantity, bool) else 0
        qty = min(
            max(qty, 0), MAX_PRICED_QUANTITY
        )  # absurd values are reported by check_selection; keep Decimal math sane
        priced.append(
            PricedLine(
                key=ln.key,
                product=ln.product,
                options=tuple(sort_options(ln.options)),
                quantity=qty,
                base_price=q(ln.product.base_price),
                unit_price=unit,
                line_total=q(unit * qty),
                discount=ZERO,
                issues=issues,
                unit_price_seen=ln.unit_price_seen,
                note=ln.note,
            )
        )
    if branch is not None and check_availability and lines:
        extra = _availability_issues(lines, priced, branch)
        for index, found in extra.items():
            priced[index] = _replace(priced[index], issues=priced[index].issues + tuple(found))
    all_issues: list[Issue] = []
    for line in priced:
        all_issues.extend(line.issues)
        changed = line.price_changed
        if changed:
            all_issues.append(
                Issue(
                    "price_changed",
                    f"The price of {line.product.name} changed.",
                    severity="warning",
                    item_id=line.key,
                    data={"was": str(changed["was"]), "now": str(changed["now"])},
                )
            )
    return priced, all_issues


def _with_item(issue: Issue, key) -> Issue:
    if key is None or issue.item_id is not None:
        return issue
    return Issue(issue.code, issue.message, issue.severity, key, issue.group, issue.status, issue.data)


def _replace(line: PricedLine, **changes) -> PricedLine:
    return replace(line, **changes)


# ── the pricing function ─────────────────────────────────────────────────────────────────────────────────────────────


def price_cart(
    lines: Sequence[LineInput],
    *,
    branch=None,
    order_type: str = "PICKUP",
    zone=None,
    coupon: Coupon | None = None,
    coupon_code: str = "",
    user=None,
    settings=None,
    automatic: Sequence[Coupon] | None = None,
    now=None,
    check_availability: bool = True,
    terms_fn: Callable | None = None,
) -> PriceBreakdown:
    """Price a set of lines end to end. See the module docstring for the formula and coupon policy.

    `coupon` (an instance) or `coupon_code` (looked up here) is the typed coupon; `automatic` overrides the automatic
    promotions considered (default: all active ones). `terms_fn(branch, zone, subtotal)` defaults to
    `apps.branches.services.delivery_terms`. The result is immutable.
    """
    from apps.core.models import StoreSettings

    settings = settings or StoreSettings.load()
    now = now or timezone.now()
    priced, issues = price_lines(lines, branch=branch, check_availability=check_availability)
    if not priced:
        issues = [Issue("cart_empty", "Your cart is empty.")]
    subtotal = sum((ln.line_total for ln in priced), ZERO)
    has_line_errors = any(i.is_blocking for ln in priced for i in ln.issues)

    # --- discount: typed coupon replaces automatic promotions; best single discount wins -----------------------------
    evaluation: CouponEvaluation | None = None
    coupon_error: Issue | None = None
    typed = coupon
    code = normalize_code(coupon_code)
    if typed is None and code:
        typed = find_coupon(code)
        if typed is None:
            coupon_error = Issue("not_found", "That promo code is not valid.", data={"coupon": code})
    if typed is not None and priced:
        try:
            evaluation = evaluate_coupon(typed, priced, user=user, now=now)
        except CouponRejected as exc:
            coupon_error = exc.as_issue()
            coupon_error = Issue(
                coupon_error.code, coupon_error.message, data={**coupon_error.data, "coupon": typed.code}
            )
    if evaluation is None and priced and not has_line_errors:
        candidates = automatic if automatic is not None else automatic_coupons(now)
        for promo in candidates:
            if typed is not None and promo.pk == typed.pk:
                continue
            try:
                candidate = evaluate_coupon(promo, priced, user=user, now=now)
            except CouponRejected:
                continue
            if evaluation is None or candidate.discount > evaluation.discount:
                evaluation = candidate
    discount_total = ZERO
    if evaluation is not None:
        discount_total = evaluation.discount
        for index, amount in evaluation.allocations.items():
            priced[index] = _replace(priced[index], discount=amount)

    # --- delivery ------------------------------------------------------------------------------------------------------
    delivery: DeliveryInfo | None = None
    delivery_fee = ZERO
    if order_type == DELIVERY and priced:
        if branch is None:
            issues.append(Issue("branch_required", "Choose a location for delivery."))
        else:
            if terms_fn is None:
                from apps.branches.services import delivery_terms as terms_fn
            try:
                terms = terms_fn(branch, zone, subtotal)
            except DomainError as exc:
                issues.append(
                    Issue(
                        str(exc.detail.code),
                        str(exc.detail),
                        status=exc.status_code,
                        data=dict(exc.extra or {}),
                    )
                )
            else:
                delivery_fee = q(terms.fee)
                delivery = DeliveryInfo(delivery_fee, q(terms.min_order_total), terms.eta_minutes)

    # --- tax & total ---------------------------------------------------------------------------------------------------
    rate = Decimal(settings.tax_rate)
    inclusive = bool(settings.prices_include_tax)
    taxable = subtotal - discount_total
    tax_total = compute_tax(taxable, rate, inclusive=inclusive)
    total = taxable + delivery_fee + (ZERO if inclusive else tax_total)

    return PriceBreakdown(
        lines=tuple(priced),
        subtotal=subtotal,
        discount_total=discount_total,
        delivery_fee=delivery_fee,
        tax_total=tax_total,
        total=q(total),
        tax_rate=rate,
        prices_include_tax=inclusive,
        currency=settings.currency,
        applied_coupon=evaluation.coupon if evaluation else None,
        coupon_error=coupon_error,
        delivery=delivery,
        issues=tuple(issues),
    )
