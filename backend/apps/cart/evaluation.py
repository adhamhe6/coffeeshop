"""Checkout evaluation: everything the checkout page shows and everything `place_order` re-checks, computed once.

`evaluate_checkout` is used both by `POST cart/preview/` (reports blockers) and by checkout (raises the first blocker),
so the customer never sees a preview the server would later contradict.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.utils import timezone

from apps.core.errors import DomainError

from .pricing import DELIVERY, LineInput, PriceBreakdown, price_cart
from .selection import Issue

_RESERVED = {"code", "message", "fields", "request_id"}


@dataclass(frozen=True)
class CheckoutEvaluation:
    breakdown: PriceBreakdown
    blockers: tuple[Issue, ...]
    branch: object
    order_type: str
    address: object
    zone: object
    requested_for: datetime | None
    estimated_ready_at: datetime | None
    eta_minutes: int | None
    tax_label: str = "Tax"

    @property
    def can_checkout(self) -> bool:
        return not self.blockers

    def raise_first_blocker(self) -> None:
        if not self.blockers:
            return
        first = self.blockers[0]
        extra = {k: v for k, v in first.data.items() if k not in _RESERVED}
        blocking = [b.as_dict() for b in self.blockers]
        if len(blocking) > 1 or first.item_id is not None:
            extra["issues"] = blocking
        fields = {"coupon_code": [first.message]} if first.data.get("field") == "coupon_code" else None
        raise DomainError(first.message, code=first.code, status_code=first.status, fields=fields, extra=extra)


def estimate_ready_at(*, branch, products, order_type, requested_for, eta_minutes, now):
    """Ready/arrival estimate: the requested slot, else now + branch prep + slowest product prep (+ delivery ETA)."""
    if requested_for is not None:
        return requested_for
    prep = (branch.prep_minutes if branch else 0) + max((p.prep_minutes for p in products), default=0)
    if order_type == DELIVERY and eta_minutes:
        prep += eta_minutes
    return now + timedelta(minutes=prep)


def evaluate_checkout(
    *,
    user,
    lines: Sequence[LineInput],
    branch,
    order_type: str,
    address=None,
    coupon_code: str = "",
    requested_for: datetime | None = None,
    now: datetime | None = None,
    store=None,
) -> CheckoutEvaluation:
    from apps.branches.services import assert_branch_accepts
    from apps.core.models import StoreSettings

    now = now or timezone.now()
    store = store or StoreSettings.load()
    blockers: list[Issue] = []

    if branch is None:
        blockers.append(Issue("branch_required", "Choose a location for your order."))
    else:
        try:
            assert_branch_accepts(branch, order_type, requested_for, now=now)
        except DomainError as exc:
            blockers.append(
                Issue(
                    str(exc.detail.code),
                    str(exc.detail),
                    status=exc.status_code,
                    data=dict(exc.extra or {}),
                )
            )

    zone = None
    if order_type == DELIVERY:
        if address is None:
            blockers.append(Issue("address_required", "Choose a delivery address."))
        else:
            zone = address.zone

    breakdown = price_cart(
        lines,
        branch=branch,
        order_type=order_type,
        zone=zone,
        coupon_code=coupon_code,
        user=user,
        settings=store,
        now=now,
    )
    for issue in breakdown.issues:
        if not issue.is_blocking or (address is None and order_type == DELIVERY and issue.code == "zone_not_served"):
            continue  # without an address the zone is unknown; `address_required` already covers it
        blockers.append(issue)
    if breakdown.coupon_error is not None and (coupon_code or "").strip():
        err = breakdown.coupon_error
        blockers.append(Issue(err.code, err.message, status=err.status, data={**err.data, "field": "coupon_code"}))
    eta = breakdown.delivery.eta_minutes if breakdown.delivery else None
    ready = (
        estimate_ready_at(
            branch=branch,
            products=[ln.product for ln in breakdown.lines],
            order_type=order_type,
            requested_for=requested_for,
            eta_minutes=eta,
            now=now,
        )
        if branch is not None and breakdown.lines
        else None
    )
    return CheckoutEvaluation(
        breakdown=breakdown,
        blockers=tuple(blockers),
        branch=branch,
        order_type=order_type,
        address=address,
        zone=zone,
        requested_for=requested_for,
        estimated_ready_at=ready,
        eta_minutes=eta,
        tax_label=store.tax_label,
    )
