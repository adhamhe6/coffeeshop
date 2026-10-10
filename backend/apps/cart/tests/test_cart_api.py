import threading
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test import RequestFactory
from django.utils import timezone

from apps.cart.models import Cart, CartItem
from apps.cart.services import merge_guest_cart
from apps.cart.tasks import cleanup_stale_carts
from apps.cart.tests.fixtures import add_to_cart, client_for
from tests.factories import make_user

pytestmark = pytest.mark.django_db
URL = "/api/v1/cart/"


def cart_of(client):
    return client.get(URL).data


def merge_request(token):
    request = RequestFactory().get("/")
    request.COOKIES = {"lantern_cart": str(token)}
    return request


# ── cookie lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────


def test_empty_cart_for_new_visitor_creates_nothing(anon):
    r = anon.get(URL)
    assert r.status_code == 200
    assert r.data["items"] == [] and r.data["item_count"] == 0 and r.data["subtotal"] == "0.00"
    assert r.data["branch_id"] is None and r.data["issues"] == []
    assert "lantern_cart" not in r.cookies
    assert Cart.objects.count() == 0


def test_first_add_creates_cart_and_sets_hardened_cookie(anon, shop):
    r = add_to_cart(anon, shop.pastry, quantity=2)
    assert r.status_code == 201
    cookie = r.cookies["lantern_cart"]
    assert cookie["httponly"] and cookie["samesite"] == "Lax" and cookie["max-age"] == 90 * 24 * 3600
    cart = Cart.objects.get()
    assert cookie.value == str(cart.token) and cart.user is None
    assert r.data["item_count"] == 2 and r.data["subtotal"] == "6.66"
    # the cookie keeps working for later requests
    assert cart_of(anon)["item_count"] == 2


def test_cookie_is_secure_when_configured(anon, shop, settings):
    settings.SESSION_COOKIE_SECURE = True
    r = add_to_cart(anon, shop.pastry)
    assert r.cookies["lantern_cart"]["secure"]


def test_garbage_or_foreign_cookie_is_ignored(anon, shop, customer):
    anon.cookies["lantern_cart"] = "not-a-uuid"
    assert cart_of(anon)["items"] == []
    user_cart = Cart.objects.create(user=customer)  # a signed-in user's cart token must not work as a guest cookie
    CartItem.objects.create(cart=user_cart, product=shop.pastry, signature="x", quantity=1, unit_price_seen="3.33")
    anon.cookies["lantern_cart"] = str(user_cart.token)
    assert cart_of(anon)["items"] == []
    anon.cookies["lantern_cart"] = str(uuid.uuid4())
    assert cart_of(anon)["items"] == []


def test_two_guests_have_isolated_carts(shop):
    a, b = client_for(), client_for()
    add_to_cart(a, shop.pastry, quantity=3)
    add_to_cart(b, shop.beans)
    assert cart_of(a)["item_count"] == 3
    assert cart_of(b)["item_count"] == 1


def test_signed_in_user_uses_user_cart_and_never_sets_guest_cookie(auth, customer, shop):
    r = add_to_cart(auth, shop.pastry)
    assert r.status_code == 201
    assert not r.cookies.get("lantern_cart") or r.cookies["lantern_cart"].value == ""
    assert Cart.objects.get().user == customer


# ── add / merge / edit ───────────────────────────────────────────────────────────────────────────────────────────────


def test_item_payload_shape(anon, shop):
    r = add_to_cart(anon, shop.latte, [shop.size_large.id, shop.oat.id], 2, note="extra hot")
    item = r.data["items"][0]
    assert item["product"] == {
        "id": shop.latte.id,
        "slug": shop.latte.slug,
        "name": "Latte",
        "image": None,
        "is_available": True,
    }
    assert item["quantity"] == 2 and item["unit_price"] == "5.50" and item["line_total"] == "11.00"
    assert item["note"] == "extra hot" and item["price_changed"] is None and item["issues"] == []
    assert [(o["group"], o["name"]) for o in item["options"]] == [("Size", "Large"), ("Milk", "Oat")]
    assert r.data["currency"] == "USD"


def test_identical_selections_merge_regardless_of_option_order(anon, shop):
    add_to_cart(anon, shop.latte, [shop.size_large.id, shop.oat.id], 1)
    r = add_to_cart(anon, shop.latte, [shop.oat.id, shop.size_large.id], 2)
    assert len(r.data["items"]) == 1 and r.data["items"][0]["quantity"] == 3
    r = add_to_cart(anon, shop.latte, [shop.size_small.id], 1)
    assert len(r.data["items"]) == 2 and r.data["item_count"] == 4


def test_merged_quantity_is_capped_at_50(anon, shop):
    add_to_cart(anon, shop.pastry, quantity=40)
    r = add_to_cart(anon, shop.pastry, quantity=30)
    assert r.data["items"][0]["quantity"] == 50


@pytest.mark.parametrize("qty", [0, 51])
def test_add_rejects_bad_quantity(anon, shop, qty):
    r = add_to_cart(anon, shop.pastry, quantity=qty)
    assert r.status_code == 400 and r.data["error"]["code"] == "invalid_quantity"
    assert Cart.objects.count() == 0 or CartItem.objects.count() == 0


def test_add_validates_like_quote(anon, shop):
    r = add_to_cart(anon, shop.latte, [])
    assert r.status_code == 400 and r.data["error"]["code"] == "required_group"
    assert r.data["error"]["errors"][0]["group"] == "Size"
    shop.pastry.is_sold_out = True
    shop.pastry.save()
    r = add_to_cart(anon, shop.pastry)
    assert r.status_code == 409 and r.data["error"]["code"] == "sold_out"
    assert anon.post(URL + "items/", {"product_id": 999999, "quantity": 1}, format="json").status_code == 404


def test_client_supplied_prices_are_ignored(anon, shop):
    r = anon.post(
        URL + "items/",
        {"product_id": shop.pastry.id, "quantity": 1, "unit_price": "0.01", "line_total": "0.01", "price": 0},
        format="json",
    )
    assert r.status_code == 201
    assert r.data["items"][0]["unit_price"] == "3.33"
    assert CartItem.objects.get().unit_price_seen == Decimal("3.33")


def test_patch_quantity_and_note_and_delete(anon, shop):
    item = add_to_cart(anon, shop.pastry, quantity=1).data["items"][0]
    r = anon.patch(f"{URL}items/{item['id']}/", {"quantity": 4, "note": "warm"}, format="json")
    assert r.status_code == 200 and r.data["items"][0]["quantity"] == 4 and r.data["items"][0]["note"] == "warm"
    assert anon.patch(f"{URL}items/{item['id']}/", {"quantity": 51}, format="json").status_code == 400
    assert anon.patch(f"{URL}items/{item['id']}/", {}, format="json").status_code == 400
    r = anon.delete(f"{URL}items/{item['id']}/")
    assert r.status_code == 200 and r.data["items"] == []
    assert anon.delete(f"{URL}items/{item['id']}/").status_code == 404


def test_changing_options_merges_into_identical_line(anon, shop):
    add_to_cart(anon, shop.latte, [shop.size_large.id], 2)
    other = add_to_cart(anon, shop.latte, [shop.size_small.id], 1).data["items"][1]
    r = anon.patch(f"{URL}items/{other['id']}/", {"option_ids": [shop.size_large.id]}, format="json")
    assert r.status_code == 200
    assert len(r.data["items"]) == 1
    assert r.data["items"][0]["quantity"] == 3
    assert r.data["items"][0]["options"][0]["name"] == "Large"


def test_changing_options_without_twin_updates_line_and_price(anon, shop):
    item = add_to_cart(anon, shop.latte, [shop.size_small.id], 1).data["items"][0]
    r = anon.patch(f"{URL}items/{item['id']}/", {"option_ids": [shop.size_large.id, shop.soy.id]}, format="json")
    updated = r.data["items"][0]
    assert updated["id"] == item["id"] and updated["unit_price"] == "5.50"
    assert CartItem.objects.get().unit_price_seen == Decimal("5.50")
    bad = anon.patch(f"{URL}items/{item['id']}/", {"option_ids": []}, format="json")
    assert bad.status_code == 400 and bad.data["error"]["code"] == "required_group"


def test_cannot_touch_another_carts_item(shop):
    a, b = client_for(), client_for()
    item = add_to_cart(a, shop.pastry).data["items"][0]
    add_to_cart(b, shop.beans)
    assert b.patch(f"{URL}items/{item['id']}/", {"quantity": 9}, format="json").status_code == 404
    assert b.delete(f"{URL}items/{item['id']}/").status_code == 404
    assert CartItem.objects.get(pk=item["id"]).quantity == 1
    assert client_for().patch(f"{URL}items/{item['id']}/", {"quantity": 2}, format="json").status_code == 404


def test_clear_cart(anon, shop):
    add_to_cart(anon, shop.pastry)
    add_to_cart(anon, shop.beans)
    r = anon.delete(URL)
    assert r.status_code == 200 and r.data["items"] == [] and r.data["item_count"] == 0
    assert anon.delete(URL).status_code == 200  # clearing an empty cart is fine
    assert client_for().delete(URL).status_code == 200  # ... and so is clearing without a cart


def test_cart_line_limit(anon, shop):
    from tests.factories import make_product

    for i in range(50):
        assert add_to_cart(anon, make_product(f"P{i}", "1.00")).status_code == 201
    r = add_to_cart(anon, shop.pastry)
    assert r.status_code == 409 and r.data["error"]["code"] == "cart_full"


# ── price changes ────────────────────────────────────────────────────────────────────────────────────────────────────


def test_price_change_is_flagged_and_acknowledged(anon, shop):
    add_to_cart(anon, shop.pastry, quantity=2)
    shop.pastry.base_price = Decimal("3.50")
    shop.pastry.save()
    data = cart_of(anon)
    item = data["items"][0]
    assert item["unit_price"] == "3.50" and item["line_total"] == "7.00"
    assert item["price_changed"] == {"was": "3.33", "now": "3.50"}
    assert data["subtotal"] == "7.00"
    assert any(i["code"] == "price_changed" and i["severity"] == "warning" for i in data["issues"])
    r = anon.post(URL + "acknowledge-prices/")
    assert r.status_code == 200
    assert r.data["items"][0]["price_changed"] is None
    assert not [i for i in r.data["issues"] if i["code"] == "price_changed"]


def test_option_price_change_is_flagged(anon, shop):
    add_to_cart(anon, shop.latte, [shop.size_large.id])
    shop.size_large.price_delta = Decimal("1.50")
    shop.size_large.save()
    assert cart_of(anon)["items"][0]["price_changed"] == {"was": "5.00", "now": "5.50"}


def test_item_that_becomes_unavailable_is_flagged_not_dropped(anon, shop):
    add_to_cart(anon, shop.pastry)
    shop.pastry.is_sold_out = True
    shop.pastry.save()
    data = cart_of(anon)
    item = data["items"][0]
    assert item["product"]["is_available"] is False
    assert item["issues"][0]["code"] == "sold_out" and item["issues"][0]["severity"] == "error"
    assert data["issues"][0]["item_id"] == item["id"]


def test_removed_option_flags_the_line(anon, shop):
    add_to_cart(anon, shop.latte, [shop.size_small.id, shop.oat.id])
    shop.oat.is_active = False
    shop.oat.save()
    item = cart_of(anon)["items"][0]
    assert item["issues"][0]["code"] == "option_unavailable"


# ── merge at login ───────────────────────────────────────────────────────────────────────────────────────────────────


def test_merge_sums_quantities_caps_and_keeps_newer_note(shop, customer):
    guest = Cart.objects.create()
    older = CartItem.objects.create(
        cart=guest, product=shop.pastry, signature="sig-a", quantity=30, note="guest", unit_price_seen="3.33"
    )
    only_guest = CartItem.objects.create(
        cart=guest, product=shop.beans, signature="sig-b", quantity=2, unit_price_seen="12.50"
    )
    mine = Cart.objects.create(user=customer)
    CartItem.objects.filter(pk=older.pk).update(updated_at=timezone.now() - timedelta(hours=1))
    CartItem.objects.create(
        cart=mine, product=shop.pastry, signature="sig-a", quantity=25, note="mine-old", unit_price_seen="3.00"
    )
    CartItem.objects.filter(cart=mine).update(updated_at=timezone.now() - timedelta(days=2))
    # guest line is newer than the user's, so the guest's note wins
    merge_guest_cart(merge_request(guest.token), customer)
    assert not Cart.objects.filter(pk=guest.pk).exists()
    lines = {i.signature: i for i in mine.items.all()}
    assert lines["sig-a"].quantity == 50 and lines["sig-a"].note == "guest"
    assert lines["sig-b"].quantity == 2 and lines["sig-b"].pk == only_guest.pk


def test_merge_keeps_user_note_when_user_line_is_newer(shop, customer):
    guest = Cart.objects.create()
    g = CartItem.objects.create(
        cart=guest, product=shop.pastry, signature="s", quantity=1, note="guest", unit_price_seen="3.33"
    )
    CartItem.objects.filter(pk=g.pk).update(updated_at=timezone.now() - timedelta(days=1))
    mine = Cart.objects.create(user=customer)
    CartItem.objects.create(
        cart=mine, product=shop.pastry, signature="s", quantity=1, note="mine", unit_price_seen="3.33"
    )
    merge_guest_cart(merge_request(guest.token), customer)
    assert mine.items.get().note == "mine" and mine.items.get().quantity == 2


def test_merge_is_idempotent(shop, customer):
    guest = Cart.objects.create()
    CartItem.objects.create(cart=guest, product=shop.pastry, signature="s", quantity=2, unit_price_seen="3.33")
    request = merge_request(guest.token)
    merge_guest_cart(request, customer)
    merge_guest_cart(request, customer)
    merge_guest_cart(merge_request(uuid.uuid4()), customer)
    merge_guest_cart(RequestFactory().get("/"), customer)  # no cookie at all
    assert customer.cart.items.get().quantity == 2


def test_merge_concurrently_counts_once(shop, customer, transactional_db):
    guest = Cart.objects.create()
    CartItem.objects.create(cart=guest, product=shop.pastry, signature="s", quantity=2, unit_price_seen="3.33")
    errors = []

    def worker():
        try:
            merge_guest_cart(merge_request(guest.token), customer)
        except Exception as exc:  # pragma: no cover
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    assert customer.cart.items.get().quantity == 2


def test_authenticated_request_folds_leftover_guest_cookie(shop, customer):
    guest = Cart.objects.create()
    CartItem.objects.create(cart=guest, product=shop.pastry, signature="s", quantity=2, unit_price_seen="3.33")
    client = client_for(customer)
    client.cookies["lantern_cart"] = str(guest.token)
    r = client.get(URL)
    assert r.data["item_count"] == 2
    assert r.cookies["lantern_cart"].value == ""  # stale guest cookie is dropped


def test_login_view_merge_hook_via_service(shop):
    """Accounts' login/register call `merge_guest_cart(request, user)`; exercise it end to end through the API client."""
    guest_client = client_for()
    add_to_cart(guest_client, shop.pastry, quantity=2)
    token = guest_client.cookies["lantern_cart"].value
    user = make_user()
    merge_guest_cart(merge_request(token), user)
    assert client_for(user).get(URL).data["item_count"] == 2
    assert guest_client.get(URL).data["item_count"] == 0  # the guest cookie now points at nothing


# ── cleanup task ─────────────────────────────────────────────────────────────────────────────────────────────────────


def test_cleanup_stale_carts(shop, customer):
    now = timezone.now()

    def cart(days, with_item, user=None):
        c = Cart.objects.create(user=user)
        if with_item:
            CartItem.objects.create(
                cart=c, product=shop.pastry, signature=f"s{c.pk}", quantity=1, unit_price_seen="3.33"
            )
        Cart.objects.filter(pk=c.pk).update(updated_at=now - timedelta(days=days))
        return c

    old_with_items = cart(91, True)
    empty_old = cart(8, False)
    empty_recent = cart(3, False)
    items_recent = cart(8, True)
    user_cart_old = cart(200, True, user=customer)
    result = cleanup_stale_carts()
    assert result == {"stale": 1, "empty": 1}
    survivors = set(Cart.objects.values_list("pk", flat=True))
    assert survivors == {empty_recent.pk, items_recent.pk, user_cart_old.pk}
    assert old_with_items.pk not in survivors and empty_old.pk not in survivors
