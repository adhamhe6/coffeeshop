"""Branch business rules: can this branch take an order, when, and on what delivery terms.

Everything here works on the branch's own calendar (``Branch.timezone``) and returns timezone-aware UTC datetimes.
Functions read ``branch.hours.all()`` / ``branch.closures.all()`` (not ``.filter()``) so callers may ``prefetch_related``
them and evaluate many branches without N+1 queries.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from django.utils import timezone

from apps.core.errors import DomainError
from apps.core.money import ZERO, q

SLOT_MINUTES = 15
MAX_DAYS_AHEAD = 7

PICKUP = "PICKUP"
DELIVERY = "DELIVERY"
ORDER_TYPES = (PICKUP, DELIVERY)


@dataclass(frozen=True)
class DeliveryTerms:
    fee: Decimal
    min_order_total: Decimal
    eta_minutes: int


# ── hours, closures ──────────────────────────────────────────────────────────────────────────────────────────────────


def hours_for_day(branch, day: date):
    """The BranchHours row for `day`'s weekday, or None. Prefetch-friendly."""
    weekday = day.weekday()
    return next((h for h in branch.hours.all() if h.weekday == weekday), None)


def is_closed_on(branch, day: date) -> bool:
    return any(c.start_date <= day <= c.end_date for c in branch.closures.all())


def opening_window(branch, day: date) -> tuple[datetime, datetime] | None:
    """(opens, closes) as aware datetimes in the branch timezone for local calendar `day`, honoring closures."""
    if is_closed_on(branch, day):
        return None
    hours = hours_for_day(branch, day)
    if not hours or hours.is_closed or not hours.opens or not hours.closes:
        return None
    tz = branch.tz
    return datetime.combine(day, hours.opens, tzinfo=tz), datetime.combine(day, hours.closes, tzinfo=tz)


def is_open_now(branch, now: datetime | None = None) -> bool:
    now = now or timezone.now()
    local = now.astimezone(branch.tz)
    window = opening_window(branch, local.date())
    return bool(window and window[0] <= local < window[1])


def next_open_at(branch, now: datetime | None = None) -> datetime | None:
    """Next instant (UTC) at which the branch is open, looking up to a week ahead. `now` itself if open now."""
    now = now or timezone.now()
    local = now.astimezone(branch.tz)
    for offset in range(0, 8):
        window = opening_window(branch, local.date() + timedelta(days=offset))
        if window is None:
            continue
        opens, closes = window
        if local < opens:
            return opens.astimezone(UTC)
        if local < closes:
            return now.astimezone(UTC)
    return None


def _format_time(value: time) -> str:
    hour12 = value.hour % 12 or 12
    return f"{hour12}:{value.minute:02d} {'AM' if value.hour < 12 else 'PM'}"


def format_hours(hours) -> str:
    if not hours or hours.is_closed or not hours.opens or not hours.closes:
        return "Closed"
    return f"{_format_time(hours.opens)} – {_format_time(hours.closes)}"


def format_slot_label(moment: datetime, branch) -> str:
    return _format_time(moment.astimezone(branch.tz).time())


# ── ASAP and slots ───────────────────────────────────────────────────────────────────────────────────────────────────


def asap_eta(branch, now: datetime | None = None) -> datetime | None:
    """Earliest ready time for an ASAP order (now + prep time), or None when the branch is not open right now."""
    now = now or timezone.now()
    if not is_open_now(branch, now):
        return None
    return (now + timedelta(minutes=branch.prep_minutes)).astimezone(UTC)


def _ceil_to_step(moment: datetime) -> datetime:
    """Round an aware datetime up to the next SLOT_MINUTES boundary (UTC-aligned, valid for all whole-quarter zones)."""
    step = SLOT_MINUTES * 60
    epoch = moment.timestamp()
    return datetime.fromtimestamp(math.ceil(epoch / step) * step, tz=UTC)


def _type_enabled(branch, order_type: str) -> bool:
    return branch.pickup_enabled if order_type == PICKUP else branch.delivery_enabled


def available_slots(branch, order_type: str, day: date, *, now: datetime | None = None) -> list[datetime]:
    """Bookable 15-minute slot starts (aware UTC) on the branch-local calendar `day`.

    Slots sit inside the opening window (start < closes), are at least ``prep_minutes`` from now (rounded up to the
    next quarter hour) and at most 7 days ahead. Closures, an inactive branch or a disabled order type yield [].
    """
    if order_type not in ORDER_TYPES or not branch.is_active or not _type_enabled(branch, order_type):
        return []
    now = now or timezone.now()
    window = opening_window(branch, day)
    if window is None:
        return []
    opens, closes = window
    earliest = _ceil_to_step(now + timedelta(minutes=branch.prep_minutes))
    latest = now + timedelta(days=MAX_DAYS_AHEAD)

    slots: list[datetime] = []
    cursor = _ceil_to_step(opens.astimezone(UTC))
    closes_utc = closes.astimezone(UTC)
    while cursor < closes_utc:
        if cursor.astimezone(branch.tz).date() == day and earliest <= cursor <= latest:
            slots.append(cursor)
        cursor += timedelta(minutes=SLOT_MINUTES)
    return slots


def slot_is_valid(branch, order_type: str, requested_for: datetime, *, now: datetime | None = None) -> bool:
    if requested_for is None or timezone.is_naive(requested_for):
        return False
    try:
        requested = requested_for.astimezone(UTC)
        if requested.second or requested.microsecond:
            return False
        day = requested.astimezone(branch.tz).date()
    except (OverflowError, ValueError):  # e.g. year 0001 with a negative UTC offset: not a valid slot, not a crash
        return False
    return requested in available_slots(branch, order_type, day, now=now)


# ── guards used by checkout ──────────────────────────────────────────────────────────────────────────────────────────


def assert_branch_accepts(
    branch, order_type: str, requested_for: datetime | None = None, *, now: datetime | None = None
):
    """Raise a DomainError with a distinct code when the branch cannot take this order. Returns None on success.

    Codes: ordering_paused (global switch), branch_closed (inactive / paused / ASAP while closed), pickup_unavailable,
    delivery_unavailable (409) and slot_invalid (400, field ``requested_for``).
    """
    from apps.core.models import StoreSettings

    now = now or timezone.now()
    if order_type not in ORDER_TYPES:
        raise DomainError("Unknown order type.", code="invalid_order_type", fields={"order_type": ["Invalid choice."]})
    if not StoreSettings.load().ordering_enabled:
        raise DomainError(
            "Online ordering is temporarily paused. Please try again soon.", code="ordering_paused", status_code=409
        )
    if not branch.is_active:
        raise DomainError(
            "This location is not available for online orders.",
            code="branch_closed",
            status_code=409,
            extra={"reason": "inactive"},
        )
    if not branch.accepting_orders:
        raise DomainError(
            f"{branch.name} has paused online orders for now. Please try again shortly.",
            code="branch_closed",
            status_code=409,
            extra={"reason": "paused"},
        )
    if order_type == PICKUP and not branch.pickup_enabled:
        raise DomainError(f"{branch.name} does not offer pickup.", code="pickup_unavailable", status_code=409)
    if order_type == DELIVERY and not branch.delivery_enabled:
        raise DomainError(f"{branch.name} does not offer delivery.", code="delivery_unavailable", status_code=409)

    if requested_for is None:
        if not is_open_now(branch, now):
            raise DomainError(
                f"{branch.name} is closed right now. Choose a time when we are open.",
                code="branch_closed",
                status_code=409,
                extra={"reason": "closed_now"},
            )
        return
    if not slot_is_valid(branch, order_type, requested_for, now=now):
        raise DomainError(
            "That time is not available. Please choose another slot.",
            code="slot_invalid",
            fields={"requested_for": ["Choose one of the available time slots."]},
        )


def delivery_terms(branch, zone, subtotal) -> DeliveryTerms:
    """Fee / minimum / ETA for delivering `subtotal` to `zone` from `branch`.

    Raises zone_not_served (no zone, inactive zone or no active link) and below_delivery_minimum.
    """
    from apps.branches.models import BranchDeliveryZone

    subtotal = q(subtotal)
    link = None
    if zone is not None and zone.is_active:
        link = BranchDeliveryZone.objects.filter(branch=branch, zone=zone, is_active=True).first()
    if link is None or not branch.delivery_enabled:
        raise DomainError(
            "We do not deliver to this area from the selected location.",
            code="zone_not_served",
            fields={"zone": ["Not served by this location."]},
        )
    minimum = q(link.min_order_total)
    if subtotal < minimum:
        raise DomainError(
            f"The minimum order for delivery to {zone.name} is {minimum}.",
            code="below_delivery_minimum",
            extra={"min_order_total": str(minimum), "subtotal": str(subtotal)},
        )
    fee = q(link.fee)
    if link.free_delivery_over is not None and subtotal >= q(link.free_delivery_over):
        fee = ZERO
    return DeliveryTerms(fee=fee, min_order_total=minimum, eta_minutes=link.eta_minutes)
