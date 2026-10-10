import threading
from datetime import timedelta
from decimal import Decimal

import pytest
import yaml
from django.core.cache import cache
from django.db import connection
from django.utils import timezone

from apps.cart.models import CartItem
from apps.cart.tests.fixtures import add_to_cart, client_for, do_checkout
from apps.orders.models import Order
from tests.factories import make_product

pytestmark = pytest.mark.django_db
D = Decimal


def test_inclusive_tax_checkout_snapshots_rate_and_keeps_total(auth, shop, store_settings):
    store_settings.tax_rate = D("8.25")
    store_settings.prices_include_tax = True
    store_settings.tax_label = "VAT"
    store_settings.save()
    add_to_cart(auth, shop.pastry, quantity=3)
    r = do_checkout(auth, shop, expected_total="9.99")
    assert r.status_code == 201
    o = r.data["order"]
    assert (o["subtotal"], o["tax_total"], o["total"]) == ("9.99", "0.76", "9.99")
    assert o["tax_rate"] == "8.25" and o["prices_include_tax"] is True
    store_settings.tax_rate = D("20.00")
    store_settings.save()
    assert auth.get(f"/api/v1/orders/{o['number']}/").data["tax_rate"] == "8.25"


def test_estimated_ready_time_uses_branch_and_slowest_product_prep(auth, shop):
    shop.branch.prep_minutes = 12
    shop.branch.save()
    slow = make_product("Slow roast", "5.00", shop.category, prep_minutes=20)
    add_to_cart(auth, shop.pastry)
    add_to_cart(auth, slow)
    before = timezone.now()
    r = do_checkout(auth, shop)
    order = Order.objects.get(number=r.data["order"]["number"])
    delta = order.estimated_ready_at - before
    assert timedelta(minutes=31, seconds=50) < delta < timedelta(minutes=32, seconds=30)


def test_delivery_estimate_adds_zone_eta(auth, customer, shop, address):
    add_to_cart(auth, shop.beans)
    before = timezone.now()
    r = do_checkout(auth, shop, order_type="DELIVERY", address_id=address.id)
    order = Order.objects.get(number=r.data["order"]["number"])
    expected = before + timedelta(minutes=shop.branch.prep_minutes + 5 + 30)  # branch prep + product prep + zone ETA
    assert abs((order.estimated_ready_at - expected).total_seconds()) < 5


def test_delivery_order_walks_the_delivery_flow(auth, customer, shop, address):
    from apps.orders.services import transition_order

    add_to_cart(auth, shop.beans)
    number = do_checkout(auth, shop, order_type="DELIVERY", address_id=address.id).data["order"]["number"]
    order = Order.objects.get(number=number)
    for target in ("CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "COMPLETED"):
        transition_order(order.pk, target, actor="system")
    d = auth.get(f"/api/v1/orders/{number}/").data
    assert d["status"] == "COMPLETED" and d["completed_at"] and d["confirmed_at"]
    assert [h["to_status"] for h in d["history"]] == [
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "OUT_FOR_DELIVERY",
        "COMPLETED",
    ]


def test_checkout_is_throttled(auth, shop, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setattr(
        ScopedRateThrottle, "THROTTLE_RATES", {**ScopedRateThrottle.THROTTLE_RATES, "checkout": "2/min"}
    )
    cache.clear()
    codes = [do_checkout(auth, shop).status_code for _ in range(4)]  # empty cart: 400 each, then 429
    assert codes == [400, 400, 429, 429]
    cache.clear()


@pytest.mark.django_db(transaction=True)
def test_concurrent_adds_of_the_same_line_never_lose_quantity(shop):
    guest = client_for()
    add_to_cart(guest, shop.pastry, quantity=1)
    cookie = guest.cookies["lantern_cart"].value
    clients = []
    for _ in range(6):
        c = client_for()
        c.cookies["lantern_cart"] = cookie
        clients.append(c)
    barrier = threading.Barrier(6)
    statuses = []

    def worker(c):
        try:
            barrier.wait()
            statuses.append(add_to_cart(c, shop.pastry, quantity=2).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(c,)) for c in clients]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert statuses == [201] * 6
    assert CartItem.objects.get().quantity == 13


def test_schema_documents_all_c1_endpoints(anon):
    r = anon.get("/api/v1/schema/")
    assert r.status_code == 200
    paths = yaml.safe_load(r.content)["paths"]
    expected = {
        "/api/v1/products/{slug}/quote/": {"post"},
        "/api/v1/cart/": {"get", "delete"},
        "/api/v1/cart/items/": {"post"},
        "/api/v1/cart/items/{id}/": {"patch", "delete"},
        "/api/v1/cart/acknowledge-prices/": {"post"},
        "/api/v1/cart/preview/": {"post"},
        "/api/v1/coupons/validate/": {"post"},
        "/api/v1/checkout/": {"post"},
        "/api/v1/orders/": {"get"},
        "/api/v1/orders/{number}/": {"get"},
        "/api/v1/orders/{number}/cancel/": {"post"},
        "/api/v1/orders/{number}/reorder/": {"post"},
        "/api/v1/orders/{number}/pay/": {"post"},
        "/api/v1/admin/coupons/": {"get", "post"},
        "/api/v1/admin/coupons/{id}/": {"get", "put", "patch", "delete"},
    }
    for path, methods in expected.items():
        assert methods <= set(paths[path]), path
