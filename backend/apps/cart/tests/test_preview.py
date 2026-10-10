from datetime import time
from decimal import Decimal

import pytest

from apps.accounts.models import Address
from apps.branches.models import BranchDeliveryZone
from apps.cart.tests.fixtures import add_to_cart, client_for
from apps.core.models import StoreSettings
from apps.promotions.models import Coupon
from tests.factories import make_address, make_user, make_zone

pytestmark = pytest.mark.django_db
URL = "/api/v1/cart/preview/"


def preview(client, shop, **body):
    payload = {"order_type": "PICKUP", "branch_id": shop.branch.id}
    payload.update(body)
    return client.post(URL, payload, format="json")


def blocker_codes(r):
    return [b["code"] for b in r.data["checkout_blockers"]]


def test_pickup_preview_breakdown(auth, shop):
    s = StoreSettings.load()
    s.tax_rate = Decimal("8.25")
    s.save()
    add_to_cart(auth, shop.pastry, quantity=3)
    r = preview(auth, shop)
    assert r.status_code == 200
    d = r.data
    assert (d["subtotal"], d["discount_total"], d["delivery_fee"], d["tax_total"], d["total"]) == (
        "9.99",
        "0.00",
        "0.00",
        "0.82",
        "10.81",
    )
    assert d["currency"] == "USD" and d["prices_include_tax"] is False and d["tax_rate"] == "8.25"
    assert d["coupon"] is None and d["coupon_error"] is None and d["delivery"] is None
    assert d["can_checkout"] is True and d["checkout_blockers"] == [] and d["item_count"] == 3
    assert d["estimated_ready_at"] is not None
    assert d["items"][0]["discount"] == "0.00"


def test_preview_with_coupon_and_coupon_error(auth, shop):
    Coupon.objects.create(code="TEN", name="Ten percent", discount_type="PERCENT", value=Decimal("10"))
    add_to_cart(auth, shop.beans, quantity=2)
    ok = preview(auth, shop, coupon_code="ten")
    assert ok.data["discount_total"] == "2.50" and ok.data["total"] == "22.50"
    assert ok.data["coupon"]["code"] == "TEN" and ok.data["coupon"]["discount"] == "2.50"
    assert ok.data["coupon"]["is_automatic"] is False
    bad = preview(auth, shop, coupon_code="WRONG")
    assert bad.data["coupon_error"] == {"code": "not_found", "message": "That promo code is not valid."}
    assert bad.data["total"] == "25.00"
    assert "not_found" in blocker_codes(bad) and bad.data["can_checkout"] is False


def test_preview_applies_automatic_promotion(auth, shop):
    Coupon.objects.create(code="AUTO10", name="Auto", discount_type="PERCENT", value=Decimal("10"), is_automatic=True)
    add_to_cart(auth, shop.beans, quantity=2)
    r = preview(auth, shop)
    assert r.data["coupon"]["is_automatic"] is True and r.data["discount_total"] == "2.50"


def test_delivery_preview(auth, shop, address):
    add_to_cart(auth, shop.beans)
    r = preview(auth, shop, order_type="DELIVERY", address_id=address.id)
    assert r.status_code == 200
    assert r.data["delivery_fee"] == "3.00" and r.data["total"] == "15.50"
    assert r.data["delivery"] == {"fee": "3.00", "min_order_total": "0.00", "eta_minutes": 30, "zone": "Old Town"}
    assert r.data["can_checkout"] is True


def test_delivery_blockers(auth, customer, shop):
    add_to_cart(auth, shop.beans)
    assert blocker_codes(preview(auth, shop, order_type="DELIVERY")) == ["address_required"]
    unserved = make_address(customer, zone=make_zone("Nowhere"))
    assert blocker_codes(preview(auth, shop, order_type="DELIVERY", address_id=unserved.id)) == ["zone_not_served"]
    no_zone = make_address(customer, zone=None)
    assert blocker_codes(preview(auth, shop, order_type="DELIVERY", address_id=no_zone.id)) == ["zone_not_served"]
    BranchDeliveryZone.objects.filter(branch=shop.branch).update(min_order_total=Decimal("50.00"))
    addr = make_address(customer, zone=shop.zone)
    r = preview(auth, shop, order_type="DELIVERY", address_id=addr.id)
    assert blocker_codes(r) == ["below_delivery_minimum"]
    assert r.data["checkout_blockers"][0]["data"]["min_order_total"] == "50.00"


def test_address_must_belong_to_the_customer(auth, shop):
    add_to_cart(auth, shop.beans)
    other = make_user()
    foreign = make_address(other, zone=shop.zone)
    assert preview(auth, shop, order_type="DELIVERY", address_id=foreign.id).status_code == 404
    assert preview(auth, shop, order_type="DELIVERY", address_id=999999).status_code == 404


def test_deleted_address_is_not_found(auth, customer, shop):
    add_to_cart(auth, shop.beans)
    addr = make_address(customer, zone=shop.zone)
    Address.objects.filter(pk=addr.pk).update(is_deleted=True)
    assert preview(auth, shop, order_type="DELIVERY", address_id=addr.id).status_code == 404


def test_anonymous_preview_works_but_address_requires_login(anon, shop):
    add_to_cart(anon, shop.beans)
    assert preview(anon, shop).status_code == 200
    r = preview(anon, shop, order_type="DELIVERY", address_id=1)
    assert r.status_code == 401


def test_branch_state_blockers(auth, shop):
    add_to_cart(auth, shop.beans)
    shop.branch.accepting_orders = False
    shop.branch.save()
    r = preview(auth, shop)
    assert blocker_codes(r) == ["branch_closed"] and r.data["can_checkout"] is False
    shop.branch.accepting_orders = True
    shop.branch.save()
    s = StoreSettings.load()
    s.ordering_enabled = False
    s.save()
    assert blocker_codes(preview(auth, shop)) == ["ordering_paused"]


def test_branch_closed_blocker(auth, shop):
    from apps.branches.tests.helpers import set_hours

    set_hours(shop.branch, dict.fromkeys(range(7)))
    add_to_cart(auth, shop.beans)
    assert blocker_codes(preview(auth, shop)) == ["branch_closed"]
    set_hours(shop.branch, {i: (time(0, 0), time(23, 59)) for i in range(7)})
    assert preview(auth, shop).data["can_checkout"] is True


def test_out_of_stock_and_empty_cart_blockers(auth, shop):
    r = preview(auth, shop)
    assert blocker_codes(r) == ["cart_empty"]
    add_to_cart(auth, shop.beans, quantity=11)
    assert blocker_codes(preview(auth, shop)) == ["out_of_stock"]


def test_preview_requires_branch_and_remembers_it(auth, shop, customer):
    add_to_cart(auth, shop.beans)
    r = auth.post(URL, {"order_type": "PICKUP"}, format="json")
    assert "branch_required" in blocker_codes(r) and r.data["branch_id"] is None
    assert auth.get("/api/v1/cart/").data["branch_id"] is None
    preview(auth, shop)
    assert auth.get("/api/v1/cart/").data["branch_id"] == shop.branch.id
    r = auth.post(URL, {"order_type": "PICKUP"}, format="json")  # falls back to the remembered branch
    assert r.data["branch_id"] == shop.branch.id and r.data["can_checkout"] is True
    assert preview(auth, shop, branch_id=424242).status_code == 404


def test_preview_validates_slot(auth, shop):
    add_to_cart(auth, shop.beans)
    r = preview(auth, shop, requested_for="2020-01-01T10:07:00Z")
    assert blocker_codes(r) == ["slot_invalid"]


def test_preview_ignores_client_prices(auth, shop):
    add_to_cart(auth, shop.beans)
    r = preview(auth, shop, total="0.01", subtotal="0.01", delivery_fee="0")
    assert r.data["total"] == "12.50"


def test_each_customer_previews_only_their_cart(shop):
    a, b = client_for(make_user()), client_for(make_user())
    add_to_cart(a, shop.beans, quantity=2)
    assert preview(b, shop).data["checkout_blockers"][0]["code"] == "cart_empty"
    assert preview(a, shop).data["subtotal"] == "25.00"
