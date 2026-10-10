import re
import threading
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.utils import timezone

from apps.accounts.models import Address
from apps.branches.services import available_slots
from apps.branches.tests.helpers import set_hours
from apps.cart.models import Cart
from apps.cart.tests.fixtures import add_to_cart, checkout_payload, client_for, do_checkout
from apps.inventory.models import InventoryMovement, StockItem
from apps.orders.models import Order, OrderStatusHistory
from apps.payments.models import Payment
from apps.promotions.models import Coupon, CouponRedemption
from tests.factories import make_address, make_user, make_zone

pytestmark = pytest.mark.django_db
D = Decimal


def stock_qty(shop):
    return StockItem.objects.get(pk=shop.beans_stock.pk).quantity


# ── success paths ────────────────────────────────────────────────────────────────────────────────────────────────────


def test_pickup_checkout_with_cash(auth, customer, shop, store_settings):
    store_settings.tax_rate = D("8.25")
    store_settings.save()
    add_to_cart(auth, shop.latte, [shop.size_large.id, shop.oat.id], 2, note="no foam")
    add_to_cart(auth, shop.beans, quantity=3)
    r = do_checkout(auth, shop, customer_notes="Ring the bell", phone="+1 555 0100")
    assert r.status_code == 201, r.data
    order = r.data["order"]
    assert re.fullmatch(rf"DT-{timezone.now():%y%m%d}-0001", order["number"])
    assert order["status"] == "PENDING" and order["payment_status"] == "PENDING" and order["order_type"] == "PICKUP"
    assert order["subtotal"] == "48.50"  # 2 x 5.50 + 3 x 12.50
    assert order["tax_total"] == "4.00" and order["total"] == "52.50"  # 48.50 x 8.25% = 4.001
    assert order["delivery_fee"] == "0.00" and order["delivery_address"] is None
    assert order["customer_name"] == customer.full_name and order["customer_phone"] == "+1 555 0100"
    assert order["customer_notes"] == "Ring the bell"
    assert order["estimated_ready_at"] is not None and order["requested_for"] is None
    latte = next(i for i in order["items"] if i["product_name"] == "Latte")
    assert latte["unit_price"] == "5.50" and latte["base_price"] == "4.00" and latte["line_total"] == "11.00"
    assert latte["note"] == "no foam" and latte["category_name"] == "Drinks" and latte["sku"].startswith("SKU-")
    assert [(o["group"], o["name"], o["price_delta"]) for o in latte["options"]] == [
        ("Size", "Large", "1.00"),
        ("Milk", "Oat", "0.50"),
    ]
    assert order["history"][0]["to_status"] == "PENDING" and order["history"][0]["actor"] == "customer"
    assert order["actions"]["can_cancel"] is True and order["actions"]["can_pay"] is False
    assert r.data["payment"]["provider"] == "cash" and r.data["payment"]["error"] is None
    # cash: a PENDING cash payment exists for the order
    assert Payment.objects.get(order__number=order["number"]).provider == "cash"
    # cart cleared, stock deducted
    assert auth.get("/api/v1/cart/").data["items"] == []
    assert stock_qty(shop) == 7
    db_order = Order.objects.get(number=order["number"])
    assert db_order.terms_accepted_at is not None and db_order.placed_at is not None
    assert db_order.tax_rate == D("8.25") and db_order.prices_include_tax is False
    assert db_order.customer_email == customer.email


def test_delivery_checkout_with_demo_payment(auth, customer, shop, address):
    add_to_cart(auth, shop.beans, quantity=2)
    r = do_checkout(auth, shop, order_type="DELIVERY", address_id=address.id, payment_method="demo")
    assert r.status_code == 201, r.data
    order = r.data["order"]
    assert order["delivery_fee"] == "3.00" and order["total"] == "28.00"
    assert order["delivery_zone_name"] == "Old Town"
    assert order["delivery_address"]["line1"] == "5 Road" and order["delivery_address"]["zone"] == "Old Town"
    assert order["customer_phone"] == address.phone
    payment = r.data["payment"]
    assert payment["provider"] == "demo" and payment["is_sandbox"] is True
    assert payment["action"]["type"] == "redirect" and "/pay/demo/" in payment["action"]["url"]
    assert payment["status"] == "REQUIRES_ACTION" and payment["error"] is None
    assert order["payment_status"] == "REQUIRES_ACTION" and order["actions"]["can_pay"] is True
    p = Payment.objects.get(order__number=order["number"])
    assert p.amount == D("28.00") and p.status == "REQUIRES_ACTION"


def test_address_snapshot_survives_address_edit_and_delete(auth, shop, address):
    add_to_cart(auth, shop.beans)
    number = do_checkout(auth, shop, order_type="DELIVERY", address_id=address.id).data["order"]["number"]
    Address.objects.filter(pk=address.pk).update(line1="Changed", is_deleted=True)
    order = auth.get(f"/api/v1/orders/{number}/").data
    assert order["delivery_address"]["line1"] == "5 Road"


def test_totals_are_recomputed_server_side_and_client_prices_ignored(auth, shop):
    add_to_cart(auth, shop.beans)
    r = do_checkout(auth, shop, total="0.01", subtotal="0.01", unit_price="0.01", delivery_fee="0")
    assert r.status_code == 201 and r.data["order"]["total"] == "12.50"


def test_requested_slot_is_accepted_and_becomes_ready_time(auth, shop):
    add_to_cart(auth, shop.pastry)
    day = (timezone.now() + timedelta(days=1)).astimezone(shop.branch.tz).date()
    slot = available_slots(shop.branch, "PICKUP", day)[4]
    r = do_checkout(auth, shop, requested_for=slot.isoformat())
    assert r.status_code == 201, r.data
    db_order = Order.objects.get(number=r.data["order"]["number"])
    assert db_order.requested_for == slot and db_order.estimated_ready_at == slot


def test_invalid_slot_is_rejected(auth, shop):
    add_to_cart(auth, shop.pastry)
    r = do_checkout(auth, shop, requested_for="2020-01-01T10:07:00Z")
    assert r.status_code == 400 and r.data["error"]["code"] == "slot_invalid"
    assert Order.objects.count() == 0 and auth.get("/api/v1/cart/").data["item_count"] == 1


def test_order_numbers_are_sequential_per_branch_and_day(customer, shop, settings):
    settings.MAX_OPEN_CASH_ORDERS_PER_CUSTOMER = 10  # this test places four cash orders for one customer
    numbers = []
    for _ in range(3):
        client = client_for(customer)
        add_to_cart(client, shop.pastry)
        numbers.append(do_checkout(client, shop).data["order"]["number"])
    today = f"{timezone.now().astimezone(shop.branch.tz):%y%m%d}"
    assert numbers == [f"DT-{today}-000{i}" for i in (1, 2, 3)]
    other_branch = make_branch_with_hours("ZZ")
    client = client_for(customer)
    add_to_cart(client, shop.pastry)
    r = do_checkout(client, shop, branch_id=other_branch.id)
    assert r.data["order"]["number"] == f"ZZ-{today}-0001"
    assert len(set(Order.objects.values_list("number", flat=True))) == 4


def make_branch_with_hours(code):
    from tests.factories import make_branch

    return make_branch(code)


def test_order_snapshots_survive_catalog_changes(auth, shop):
    add_to_cart(auth, shop.latte, [shop.size_large.id], 2)
    number = do_checkout(auth, shop).data["order"]["number"]
    shop.latte.name = "Renamed"
    shop.latte.base_price = D("9.99")
    shop.latte.save()
    shop.size_large.name = "XL"
    shop.size_large.price_delta = D("2.00")
    shop.size_large.save()
    shop.category.name = "Beverages"
    shop.category.save()
    order = auth.get(f"/api/v1/orders/{number}/").data
    item = order["items"][0]
    assert item["product_name"] == "Latte" and item["unit_price"] == "5.00" and item["line_total"] == "10.00"
    assert item["options"][0]["name"] == "Large" and item["options"][0]["price_delta"] == "1.00"
    assert item["category_name"] == "Drinks"
    assert order["total"] == "10.00"
    shop.latte.delete()  # product row can vanish; the order keeps its snapshot
    item = auth.get(f"/api/v1/orders/{number}/").data["items"][0]
    assert item["product_name"] == "Latte" and item["product_id"] is None


# ── validation failures ──────────────────────────────────────────────────────────────────────────────────────────────


def test_idempotency_key_is_required_and_validated(auth, shop):
    add_to_cart(auth, shop.pastry)
    r = auth.post("/api/v1/checkout/", checkout_payload(shop), format="json")
    assert r.status_code == 400 and r.data["error"]["code"] == "idempotency_key_required"
    r = auth.post("/api/v1/checkout/", checkout_payload(shop), format="json", headers={"Idempotency-Key": "short"})
    assert r.status_code == 400 and r.data["error"]["code"] == "idempotency_key_invalid"
    r = auth.post("/api/v1/checkout/", checkout_payload(shop), format="json", headers={"Idempotency-Key": "x" * 65})
    assert r.status_code == 400
    assert Order.objects.count() == 0


def test_checkout_requires_authentication(anon, shop):
    add_to_cart(anon, shop.pastry)
    r = do_checkout(anon, shop)
    assert r.status_code == 401 and r.data["error"]["code"] == "not_authenticated"


def test_terms_must_be_accepted(auth, shop):
    add_to_cart(auth, shop.pastry)
    r = do_checkout(auth, shop, accept_terms=False)
    assert r.status_code == 400 and "accept_terms" in r.data["error"]["fields"]
    r = auth.post(
        "/api/v1/checkout/",
        {k: v for k, v in checkout_payload(shop).items() if k != "accept_terms"},
        format="json",
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 400
    assert Order.objects.count() == 0


def test_empty_cart(auth, shop):
    r = do_checkout(auth, shop)
    assert r.status_code == 400 and r.data["error"]["code"] == "cart_empty"


def test_closed_branch(auth, shop):
    add_to_cart(auth, shop.pastry)
    set_hours(shop.branch, dict.fromkeys(range(7)))
    r = do_checkout(auth, shop)
    assert r.status_code == 409 and r.data["error"]["code"] == "branch_closed"
    assert Order.objects.count() == 0 and stock_qty(shop) == 10


def test_paused_branch_and_global_pause(auth, shop, store_settings):
    add_to_cart(auth, shop.pastry)
    shop.branch.accepting_orders = False
    shop.branch.save()
    r = do_checkout(auth, shop)
    assert r.status_code == 409 and r.data["error"]["code"] == "branch_closed"
    shop.branch.accepting_orders = True
    shop.branch.save()
    store_settings.ordering_enabled = False
    store_settings.save()
    r = do_checkout(auth, shop)
    assert r.status_code == 409 and r.data["error"]["code"] == "ordering_paused"
    assert Order.objects.count() == 0


def test_unknown_branch_is_404(auth, shop):
    add_to_cart(auth, shop.pastry)
    assert do_checkout(auth, shop, branch_id=987654).status_code == 404


def test_delivery_requires_address_and_served_zone(auth, customer, shop):
    add_to_cart(auth, shop.beans)
    r = do_checkout(auth, shop, order_type="DELIVERY")
    assert r.status_code == 400 and "address_id" in r.data["error"]["fields"]
    unserved = make_address(customer, zone=make_zone("Nowhere"))
    r = do_checkout(auth, shop, order_type="DELIVERY", address_id=unserved.id)
    assert r.status_code == 400 and r.data["error"]["code"] == "zone_not_served"
    nozone = make_address(customer, zone=None)
    assert (
        do_checkout(auth, shop, order_type="DELIVERY", address_id=nozone.id).data["error"]["code"] == "zone_not_served"
    )
    assert Order.objects.count() == 0


def test_delivery_below_zone_minimum(auth, customer, shop):
    from apps.branches.models import BranchDeliveryZone

    BranchDeliveryZone.objects.filter(branch=shop.branch).update(min_order_total=D("30.00"))
    add_to_cart(auth, shop.beans)
    addr = make_address(customer, zone=shop.zone)
    r = do_checkout(auth, shop, order_type="DELIVERY", address_id=addr.id)
    assert r.status_code == 400 and r.data["error"]["code"] == "below_delivery_minimum"
    assert r.data["error"]["min_order_total"] == "30.00"


def test_pickup_unavailable_when_branch_has_no_pickup(auth, shop):
    add_to_cart(auth, shop.pastry)
    shop.branch.pickup_enabled = False
    shop.branch.save()
    r = do_checkout(auth, shop)
    assert r.status_code == 409 and r.data["error"]["code"] == "pickup_unavailable"


def test_foreign_address_is_404(auth, shop):
    add_to_cart(auth, shop.beans)
    foreign = make_address(make_user(), zone=shop.zone)
    r = do_checkout(auth, shop, order_type="DELIVERY", address_id=foreign.id)
    assert r.status_code == 404
    assert Order.objects.count() == 0 and auth.get("/api/v1/cart/").data["item_count"] == 1


def test_deleted_address_is_404(auth, address, shop):
    add_to_cart(auth, shop.beans)
    Address.objects.filter(pk=address.pk).update(is_deleted=True)
    assert do_checkout(auth, shop, order_type="DELIVERY", address_id=address.id).status_code == 404


def test_disabled_or_unknown_payment_method(auth, shop, settings):
    add_to_cart(auth, shop.pastry)
    r = do_checkout(auth, shop, payment_method="bitcoin")
    assert r.status_code == 400 and r.data["error"]["code"] == "payment_method_unavailable"
    settings.PAYMENT_PROVIDERS_ENABLED = ["cash"]
    r = do_checkout(auth, shop, payment_method="demo")
    assert r.status_code == 400 and r.data["error"]["code"] == "payment_method_unavailable"
    settings.PAYMENT_DEMO_ENABLED = False
    settings.PAYMENT_PROVIDERS_ENABLED = ["demo", "cash"]
    assert do_checkout(auth, shop, payment_method="demo").data["error"]["code"] == "payment_method_unavailable"
    assert Order.objects.count() == 0


def test_store_allow_list_restricts_methods(auth, shop, store_settings):
    from django.core.cache import cache

    store_settings.allowed_checkout_methods = ["cash"]
    store_settings.save()
    cache.clear()
    add_to_cart(auth, shop.pastry)
    assert do_checkout(auth, shop, payment_method="demo").status_code == 400
    assert do_checkout(auth, shop, payment_method="cash").status_code == 201


def test_invalid_cart_lines_block_checkout(auth, shop):
    add_to_cart(auth, shop.latte, [shop.size_small.id])
    shop.latte.is_sold_out = True
    shop.latte.save()
    r = do_checkout(auth, shop)
    assert r.status_code == 409 and r.data["error"]["code"] == "sold_out"
    assert Order.objects.count() == 0


def test_bad_input_shapes(auth, shop):
    add_to_cart(auth, shop.pastry)
    assert do_checkout(auth, shop, order_type="TELEPORT").status_code == 400
    assert do_checkout(auth, shop, phone="<script>").status_code == 400
    assert do_checkout(auth, shop, expected_total="abc").status_code == 400
    assert do_checkout(auth, shop, customer_notes="x" * 301).status_code == 400
    assert Order.objects.count() == 0


# ── price confirmation ───────────────────────────────────────────────────────────────────────────────────────────────


def test_expected_total_mismatch_returns_409_with_fresh_preview(auth, shop):
    add_to_cart(auth, shop.pastry, quantity=2)
    shop.pastry.base_price = D("4.00")
    shop.pastry.save()
    r = do_checkout(auth, shop, expected_total="6.66")
    assert r.status_code == 409 and r.data["error"]["code"] == "price_changed"
    assert r.data["error"]["preview"]["total"] == "8.00"
    assert r.data["error"]["preview"]["items"][0]["unit_price"] == "4.00"
    assert Order.objects.count() == 0 and auth.get("/api/v1/cart/").data["item_count"] == 2
    ok = do_checkout(auth, shop, expected_total="8.00")
    assert ok.status_code == 201 and ok.data["order"]["total"] == "8.00"


# ── coupons at checkout ──────────────────────────────────────────────────────────────────────────────────────────────


def test_checkout_with_coupon_records_redemption(auth, customer, shop):
    coupon = Coupon.objects.create(code="TEN", name="Ten", discount_type="PERCENT", value=D("10"), usage_limit=5)
    add_to_cart(auth, shop.beans, quantity=2)
    r = do_checkout(auth, shop, coupon_code="ten", expected_total="22.50")
    assert r.status_code == 201, r.data
    o = r.data["order"]
    assert o["discount_total"] == "2.50" and o["total"] == "22.50" and o["coupon_code"] == "TEN"
    assert o["items"][0]["discount_amount"] == "2.50"
    coupon.refresh_from_db()
    assert coupon.times_redeemed == 1
    redemption = CouponRedemption.objects.get()
    assert redemption.user == customer and redemption.discount_amount == D("2.50") and not redemption.is_voided
    assert Order.objects.get().coupon == coupon


def test_automatic_promotion_is_applied_and_counted(auth, shop):
    promo = Coupon.objects.create(code="AUTO", name="Auto", discount_type="FIXED", value=D("2.00"), is_automatic=True)
    add_to_cart(auth, shop.beans)
    r = do_checkout(auth, shop)
    assert r.data["order"]["discount_total"] == "2.00" and r.data["order"]["total"] == "10.50"
    promo.refresh_from_db()
    assert promo.times_redeemed == 1


def test_invalid_coupon_blocks_checkout(auth, shop):
    add_to_cart(auth, shop.pastry)
    r = do_checkout(auth, shop, coupon_code="NOPE")
    assert r.status_code == 400 and r.data["error"]["code"] == "not_found"
    assert Order.objects.count() == 0
    Coupon.objects.create(code="BIG", name="Big", discount_type="FIXED", value=D("1"), min_order_total=D("99"))
    assert do_checkout(auth, shop, coupon_code="BIG").data["error"]["code"] == "min_order_not_met"


def test_per_customer_limit_enforced_across_orders(customer, shop):
    Coupon.objects.create(code="ONCE", name="Once", discount_type="FIXED", value=D("1"), per_customer_limit=1)
    c1 = client_for(customer)
    add_to_cart(c1, shop.beans)
    assert do_checkout(c1, shop, coupon_code="ONCE").status_code == 201
    add_to_cart(c1, shop.beans)
    r = do_checkout(c1, shop, coupon_code="ONCE")
    assert r.status_code == 400 and r.data["error"]["code"] == "per_customer_limit"


def test_free_order_skips_payment_and_uses_cash(auth, shop):
    Coupon.objects.create(code="FREE", name="Free", discount_type="PERCENT", value=D("100"))
    add_to_cart(auth, shop.pastry)
    r = do_checkout(auth, shop, coupon_code="FREE", payment_method="demo")
    assert r.status_code == 201, r.data
    assert r.data["order"]["total"] == "0.00" and r.data["order"]["payment_method"] == "cash"
    assert Payment.objects.count() == 0


# ── payment hand-off ─────────────────────────────────────────────────────────────────────────────────────────────────


def test_payment_provider_failure_keeps_order_and_reports_error(auth, shop, monkeypatch):
    from apps.core.errors import DomainError

    def boom(order, provider_key, *, return_url, cancel_url):
        raise DomainError("Provider down", code="payment_provider_unavailable", status_code=502)

    monkeypatch.setattr("apps.payments.services.start_payment", boom)
    add_to_cart(auth, shop.beans)
    r = do_checkout(auth, shop, payment_method="demo")
    assert r.status_code == 201
    assert r.data["payment"]["error"] == {"code": "payment_provider_unavailable", "message": "Provider down"}
    assert r.data["order"]["status"] == "PENDING" and r.data["order"]["payment_status"] == "PENDING"
    assert Order.objects.count() == 1 and stock_qty(shop) == 9


def test_unexpected_provider_exception_is_contained(auth, shop, monkeypatch):
    def boom(order, provider_key, *, return_url, cancel_url):
        raise RuntimeError("socket exploded")

    monkeypatch.setattr("apps.payments.services.start_payment", boom)
    add_to_cart(auth, shop.beans)
    r = do_checkout(auth, shop, payment_method="demo")
    assert r.status_code == 201 and r.data["payment"]["error"]["code"] == "payment_start_failed"


def test_start_payment_receives_urls_and_notification_fires(
    auth, shop, monkeypatch, settings, django_capture_on_commit_callbacks
):
    calls, events = [], []
    real = __import__("apps.payments.services", fromlist=["start_payment"]).start_payment

    def spy(order, provider_key, *, return_url, cancel_url):
        calls.append((order.number, provider_key, return_url, cancel_url))
        return real(order, provider_key, return_url=return_url, cancel_url=cancel_url)

    monkeypatch.setattr("apps.payments.services.start_payment", spy)
    monkeypatch.setattr(
        "apps.notifications.services.notify_order_event", lambda order, kind: events.append((order.number, kind))
    )
    settings.SITE_URL = "https://shop.example"
    add_to_cart(auth, shop.beans)
    with django_capture_on_commit_callbacks(execute=True):
        r = do_checkout(auth, shop, payment_method="demo")
    number = r.data["order"]["number"]
    assert calls == [
        (
            number,
            "demo",
            f"https://shop.example/orders/{number}/confirmation",
            f"https://shop.example/orders/{number}?payment=cancelled",
        )
    ]
    assert events == [(number, "order_placed")]


# ── idempotency ──────────────────────────────────────────────────────────────────────────────────────────────────────


def test_replay_returns_original_order_without_side_effects(auth, shop):
    add_to_cart(auth, shop.beans, quantity=2)
    key = str(uuid.uuid4())
    first = do_checkout(auth, shop, key, payment_method="demo")
    assert first.status_code == 201
    add_to_cart(auth, shop.beans, quantity=1)  # a new cart in between must not be consumed by the replay
    second = do_checkout(auth, shop, key, payment_method="demo")
    assert second.status_code == 200
    assert second.data["order"]["number"] == first.data["order"]["number"]
    assert (
        second.data["payment"]["provider"] == "demo"
        and second.data["payment"]["action"] == first.data["payment"]["action"]
    )
    assert Order.objects.count() == 1 and Payment.objects.count() == 1
    assert stock_qty(shop) == 8
    assert auth.get("/api/v1/cart/").data["item_count"] == 1


def test_same_key_from_two_customers_makes_two_orders(shop):
    key = str(uuid.uuid4())
    a, b = client_for(make_user()), client_for(make_user())
    add_to_cart(a, shop.pastry)
    add_to_cart(b, shop.pastry)
    assert do_checkout(a, shop, key).status_code == 201
    assert do_checkout(b, shop, key).status_code == 201
    assert Order.objects.count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_replays_create_exactly_one_order(customer, shop):
    Coupon.objects.create(code="ONE", name="One", discount_type="FIXED", value=D("1"), usage_limit=100)
    setup = client_for(customer)
    add_to_cart(setup, shop.beans, quantity=2)
    key = str(uuid.uuid4())
    clients = [client_for(customer) for _ in range(8)]
    results, errors = [], []
    barrier = threading.Barrier(8)

    def worker(client):
        try:
            barrier.wait()
            results.append(do_checkout(client, shop, key, coupon_code="ONE", payment_method="cash"))
        except Exception as exc:  # pragma: no cover
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(c,)) for c in clients]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors, errors
    assert sorted(r.status_code for r in results) == [200] * 7 + [201]
    assert {r.data["order"]["number"] for r in results} == {Order.objects.get().number}
    assert Order.objects.count() == 1
    assert stock_qty(shop) == 8
    assert InventoryMovement.objects.filter(movement_type="SALE").count() == 1
    assert CouponRedemption.objects.count() == 1 and Coupon.objects.get(code="ONE").times_redeemed == 1
    assert OrderStatusHistory.objects.count() == 1


# ── concurrency on scarce resources ──────────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db(transaction=True)
def test_last_unit_of_stock_goes_to_exactly_one_customer(shop):
    StockItem.objects.filter(pk=shop.beans_stock.pk).update(quantity=1)
    users = [make_user(), make_user()]
    clients = [client_for(u) for u in users]
    for c in clients:
        assert add_to_cart(c, shop.beans).status_code == 201
    results = []
    barrier = threading.Barrier(2)

    def worker(client):
        try:
            barrier.wait()
            results.append(do_checkout(client, shop))
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(c,)) for c in clients]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(r.status_code for r in results) == [201, 409]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.data["error"]["code"] == "out_of_stock"
    assert loser.data["error"]["items"][0]["name"] == "House Beans"
    assert stock_qty(shop) == 0
    assert Order.objects.count() == 1
    # the loser keeps their cart for another try
    survivors = [Cart.objects.get(user=u).items.count() for u in users]
    assert sorted(survivors) == [0, 1]


@pytest.mark.django_db(transaction=True)
def test_coupon_with_usage_limit_one_is_redeemed_once(shop):
    coupon = Coupon.objects.create(code="LAST", name="Last", discount_type="FIXED", value=D("1"), usage_limit=1)
    clients = [client_for(make_user()) for _ in range(2)]
    for c in clients:
        add_to_cart(c, shop.pastry)
    results = []
    barrier = threading.Barrier(2)

    def worker(client):
        try:
            barrier.wait()
            results.append(do_checkout(client, shop, coupon_code="LAST"))
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(c,)) for c in clients]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(r.status_code for r in results) in ([201, 400], [201, 409])
    loser = next(r for r in results if r.status_code != 201)
    assert loser.data["error"]["code"] == "exhausted"
    coupon.refresh_from_db()
    assert coupon.times_redeemed == 1 and CouponRedemption.objects.count() == 1 and Order.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_many_customers_ordering_at_once_get_unique_numbers(shop):
    n = 6
    clients = [client_for(make_user()) for _ in range(n)]
    for c in clients:
        add_to_cart(c, shop.pastry)
    results = []
    barrier = threading.Barrier(n)

    def worker(client):
        try:
            barrier.wait()
            results.append(do_checkout(client, shop))
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(c,)) for c in clients]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert [r.status_code for r in results] == [201] * n
    numbers = sorted(Order.objects.values_list("number", flat=True))
    assert len(set(numbers)) == n and numbers[0].endswith("-0001") and numbers[-1].endswith(f"-000{n}")


def test_stock_exhaustion_rolls_back_everything(auth, shop):
    other = client_for(make_user())
    add_to_cart(other, shop.beans, quantity=10)
    assert do_checkout(other, shop).status_code == 201
    Coupon.objects.create(code="TEN", name="Ten", discount_type="PERCENT", value=D("10"))
    add_to_cart(auth, shop.beans)
    r = do_checkout(auth, shop, coupon_code="TEN")
    assert r.status_code == 409 and r.data["error"]["code"] == "out_of_stock"
    assert Order.objects.count() == 1 and CouponRedemption.objects.count() == 0
    assert Coupon.objects.get().times_redeemed == 0
    assert auth.get("/api/v1/cart/").data["item_count"] == 1
