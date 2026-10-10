"""Coupon / promotion rules shared by pricing, the validate endpoint, checkout and order cancellation.

Evaluation of *what a coupon is worth for a given cart* lives in `apps.cart.pricing` (single pricing implementation);
this module owns lookups and the redemption ledger.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .models import Coupon, CouponRedemption

log = logging.getLogger(__name__)


def normalize_code(code: str | None) -> str:
    return (code or "").strip().upper()


def find_coupon(code: str | None) -> Coupon | None:
    """Case-insensitive lookup. Inactive coupons are returned too (the caller reports the reason)."""
    code = normalize_code(code)
    if not code:
        return None
    return Coupon.objects.filter(code__iexact=code).prefetch_related("categories", "products").first()


def automatic_coupons(now=None) -> list[Coupon]:
    """Active automatic promotions whose window is open now (usage and eligibility are checked by pricing)."""
    now = now or timezone.now()
    return list(
        Coupon.objects.filter(is_automatic=True, is_active=True)
        .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now))
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        .prefetch_related("categories", "products")
        .order_by("id")
    )


def customer_redemption_count(coupon: Coupon, user) -> int:
    """Non-voided redemptions of `coupon` by `user`."""
    if user is None or not getattr(user, "is_authenticated", False):
        return 0
    return CouponRedemption.objects.filter(coupon=coupon, user=user, is_voided=False).count()


def has_previous_orders(user, *, exclude_order_id: int | None = None) -> bool:
    """True when the customer already has an order that was not cancelled (so `first_order_only` coupons are spent)."""
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    from apps.orders.models import Order

    qs = Order.objects.filter(customer=user).exclude(status=Order.Status.CANCELLED)
    if exclude_order_id:
        qs = qs.exclude(pk=exclude_order_id)
    return qs.exists()


def void_redemption(order) -> bool:
    """Void the order's coupon redemption (cancelled/expired order) and give the usage back. Idempotent.

    Call inside the cancelling transaction. Returns True when a redemption was voided by this call.
    """
    with transaction.atomic():
        probe = (
            CouponRedemption.objects.filter(order=order, is_voided=False).values_list("coupon_id", flat=True).first()
        )
        if probe is None:
            return False
        # Same lock order as checkout (coupon row, then redemption).
        Coupon.objects.select_for_update().filter(pk=probe).first()
        redemption = CouponRedemption.objects.select_for_update().filter(order=order, is_voided=False).first()
        if redemption is None:
            return False
        redemption.is_voided = True
        redemption.save(update_fields=["is_voided"])
        Coupon.objects.filter(pk=redemption.coupon_id, times_redeemed__gt=0).update(
            times_redeemed=F("times_redeemed") - 1
        )
        log.info("coupon redemption voided order=%s coupon=%s", order.number, redemption.coupon_id)
        return True
