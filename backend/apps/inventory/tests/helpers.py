"""Helpers to build orders directly through the ORM (order creation itself belongs to the orders app)."""

from decimal import Decimal
from itertools import count

from django.utils import timezone

from apps.orders.models import Order, OrderItem
from tests.factories import make_user

_n = count(1)


def make_order(branch, items, customer=None, *, status="PENDING", number=None):
    """items: iterable of (product, quantity)."""
    customer = customer or make_user()
    n = next(_n)
    order = Order.objects.create(
        number=number or f"T-{n:06d}",
        customer=customer,
        branch=branch,
        order_type="PICKUP",
        status=status,
        payment_method="cash",
        currency="USD",
        subtotal=Decimal("10.00"),
        total=Decimal("10.00"),
        customer_name="Test Customer",
        customer_email=customer.email,
        idempotency_key=f"key-{n}",
        placed_at=timezone.now(),
    )
    for product, qty in items:
        OrderItem.objects.create(
            order=order,
            product=product,
            product_name=product.name,
            sku=product.sku,
            base_price=product.base_price,
            unit_price=product.base_price,
            quantity=qty,
            line_total=product.base_price * qty,
        )
    return order
