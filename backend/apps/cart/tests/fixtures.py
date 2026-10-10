"""Shared fixtures/helpers for the cart, promotions and orders test-suites (imported by each conftest)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from tests.factories import (
    make_address,
    make_branch,
    make_category,
    make_modifier_group,
    make_product,
    make_stock,
    make_user,
    make_zone,
)


@dataclass
class Shop:
    branch: object
    zone: object
    category: object
    latte: object  # PREPARED, $4.00, required Size (Small +0 / Large +1.00), optional Milk (Oat +0.50, Soy +0.50)
    size_small: object
    size_large: object
    oat: object
    soy: object
    beans: object  # STOCKED, $12.50, 10 in stock
    beans_stock: object
    pastry: object  # PREPARED, $3.33


@pytest.fixture
def shop(db, store_settings):
    branch = make_branch("DT", delivery=True)
    zone = make_zone("Old Town", branch=branch, fee="3.00", min_order="0.00")
    category = make_category("Drinks")
    latte = make_product("Latte", "4.00", category)
    size, (small, large) = make_modifier_group(
        latte, "Size", required=True, options=[("Small", "0.00", True), ("Large", "1.00")]
    )
    milk, (oat, soy) = make_modifier_group(
        latte, "Milk", multiple=True, max_select=2, options=[("Oat", "0.50"), ("Soy", "0.50")]
    )
    beans = make_product("House Beans", "12.50", make_category("Beans"), stocked=True)
    stock = make_stock(branch, beans, 10)
    pastry = make_product("Croissant", "3.33", make_category("Bakery"))
    return Shop(branch, zone, category, latte, small, large, oat, soy, beans, stock, pastry)


def client_for(user=None) -> APIClient:
    client = APIClient(enforce_csrf_checks=False)
    if user is not None:
        client.force_login(user)
    return client


@pytest.fixture
def customer(db):
    return make_user()


@pytest.fixture
def auth(customer):
    return client_for(customer)


@pytest.fixture
def anon():
    return client_for()


def add_to_cart(client, product, option_ids=(), quantity=1, note=""):
    return client.post(
        "/api/v1/cart/items/",
        {"product_id": product.id, "option_ids": list(option_ids), "quantity": quantity, "note": note},
        format="json",
    )


def checkout_payload(shop, **overrides):
    payload = {
        "branch_id": shop.branch.id,
        "order_type": "PICKUP",
        "payment_method": "cash",
        "accept_terms": True,
    }
    payload.update(overrides)
    return payload


def do_checkout(client, shop, key=None, **overrides):
    return client.post(
        "/api/v1/checkout/",
        checkout_payload(shop, **overrides),
        format="json",
        headers={"Idempotency-Key": key or str(uuid.uuid4())},
    )


def D(value) -> Decimal:
    return Decimal(str(value))


@pytest.fixture
def address(customer, shop):
    return make_address(customer, zone=shop.zone)


def make_order(
    shop,
    user,
    *,
    status="PENDING",
    order_type="PICKUP",
    method="cash",
    payment_status="PENDING",
    total="10.00",
    placed_at=None,
    **kw,
):
    """A bare order row (no items, no stock movement) for state-machine and listing tests."""
    from django.utils import timezone

    from apps.orders.models import Order

    n = Order.objects.count() + 1
    placed_at = placed_at or timezone.now()
    snapshot = {"line1": "1 Road", "city": "Town"} if order_type == "DELIVERY" else None
    return Order.objects.create(
        number=kw.pop("number", f"T{shop.branch.id}-{n:05d}"),
        customer=user,
        branch=shop.branch,
        order_type=order_type,
        status=status,
        payment_status=payment_status,
        payment_method=method,
        currency="USD",
        subtotal=Decimal(total),
        total=Decimal(total),
        customer_name=user.full_name,
        customer_email=user.email,
        idempotency_key=kw.pop("idempotency_key", f"key-{uuid.uuid4()}"),
        placed_at=placed_at,
        delivery_address=snapshot,
        **kw,
    )
