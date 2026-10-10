"""Decimal money helpers. All money is Decimal with 2 places; never floats."""

from decimal import ROUND_HALF_UP, Decimal

TWOPLACES = Decimal("0.01")
ZERO = Decimal("0.00")


def q(value) -> Decimal:
    """Quantize to cents using half-up rounding."""
    return Decimal(value).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
