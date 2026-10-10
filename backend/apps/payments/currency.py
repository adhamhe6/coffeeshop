"""Minor-unit conversion for payment providers.

The platform stores money as 2-decimal `Decimal`; card networks work in the currency's minor unit. Zero-decimal
currencies (JPY, KRW, ...) have no fraction at all and three-decimal currencies (KWD, BHD, ...) have one extra digit.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from apps.core.errors import DomainError

ZERO_DECIMAL = frozenset(
    ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]
)
# ISK and UGX are zero-decimal for customers but the Stripe API still expects two-decimal amounts (multiples of 100).
THREE_DECIMAL = frozenset(["bhd", "jod", "kwd", "omr", "tnd"])


def exponent(currency: str) -> int:
    c = currency.lower()
    if c in ZERO_DECIMAL:
        return 0
    if c in THREE_DECIMAL:
        return 3
    return 2


def to_minor(amount: Decimal, currency: str) -> int:
    """Decimal major units -> integer minor units. Refuses amounts that cannot be represented exactly."""
    amount = Decimal(amount)
    scaled = amount * (Decimal(10) ** exponent(currency))
    minor = scaled.quantize(Decimal(1), rounding=ROUND_HALF_UP)
    if minor != scaled:
        raise DomainError(
            f"{currency.upper()} amounts cannot have fractional units.", code="unsupported_amount", status_code=400
        )
    return int(minor)


def from_minor(minor: int | str | None, currency: str) -> Decimal | None:
    """Integer minor units -> Decimal major units (2dp, or 0dp for zero-decimal currencies stored as `x.00`)."""
    if minor is None:
        return None
    value = Decimal(int(minor)) / (Decimal(10) ** exponent(currency))
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
