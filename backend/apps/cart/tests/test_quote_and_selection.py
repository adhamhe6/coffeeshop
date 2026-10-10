import pytest

from apps.catalog.models import ModifierOption
from tests.factories import make_modifier_group, make_product

pytestmark = pytest.mark.django_db


def quote(client, product, option_ids=(), quantity=1, **extra):
    return client.post(
        f"/api/v1/products/{product.slug}/quote/",
        {"option_ids": list(option_ids), "quantity": quantity, **extra},
        format="json",
    )


def codes(response):
    return [e["code"] for e in response.data["errors"]]


def test_quote_is_public_and_prices_on_the_server(anon, shop):
    r = quote(anon, shop.latte, [shop.size_large.id, shop.oat.id], 2)
    assert r.status_code == 200
    assert r.data["valid"] is True and r.data["errors"] == []
    assert r.data["base_price"] == "4.00"
    assert r.data["unit_price"] == "5.50"
    assert r.data["line_total"] == "11.00"
    assert {(o["group"], o["name"], o["price_delta"]) for o in r.data["options"]} == {
        ("Size", "Large", "1.00"),
        ("Milk", "Oat", "0.50"),
    }


def test_quote_ignores_client_supplied_prices(anon, shop):
    r = quote(
        anon, shop.latte, [shop.size_small.id], 1, unit_price="0.01", base_price="0.01", line_total="0.01", total="0.01"
    )
    assert r.data["unit_price"] == "4.00" and r.data["line_total"] == "4.00"


def test_quote_missing_required_group(anon, shop):
    r = quote(anon, shop.latte, [])
    assert r.status_code == 200 and r.data["valid"] is False
    assert codes(r) == ["required_group"]
    assert r.data["errors"][0]["group"] == "Size"


def test_quote_too_many_options(anon, shop):
    extra = ModifierOption.objects.create(group=shop.oat.group, name="Almond", price_delta="0.50")
    r = quote(anon, shop.latte, [shop.size_small.id, shop.oat.id, shop.soy.id, extra.id])
    assert codes(r) == ["too_many_options"]
    assert r.data["errors"][0]["group"] == "Milk"


def test_single_choice_group_rejects_two_options(anon, shop):
    r = quote(anon, shop.latte, [shop.size_small.id, shop.size_large.id])
    assert codes(r) == ["too_many_options"]


def test_option_from_another_product_is_rejected(anon, shop):
    other = make_product("Tea", "3.00")
    _, (foreign,) = make_modifier_group(other, "Honey", options=[("Honey", "0.20")])
    r = quote(anon, shop.latte, [shop.size_small.id, foreign.id])
    assert r.data["valid"] is False and "invalid_option" in codes(r)


def test_unknown_option_id_is_rejected(anon, shop):
    r = quote(anon, shop.latte, [shop.size_small.id, 999999])
    assert "invalid_option" in codes(r)


def test_inactive_or_unavailable_option_is_rejected(anon, shop):
    shop.oat.is_active = False
    shop.oat.save()
    shop.soy.is_available = False
    shop.soy.save()
    assert "option_unavailable" in codes(quote(anon, shop.latte, [shop.size_small.id, shop.oat.id]))
    assert "option_unavailable" in codes(quote(anon, shop.latte, [shop.size_small.id, shop.soy.id]))


def test_inactive_group_options_are_not_selectable_and_not_required(anon, shop):
    group = shop.size_small.group
    group.is_active = False
    group.save()
    assert quote(anon, shop.latte, []).data["valid"] is True  # required group no longer applies
    assert "invalid_option" in codes(quote(anon, shop.latte, [shop.size_small.id]))


def test_sold_out_and_inactive_products(anon, shop):
    shop.pastry.is_sold_out = True
    shop.pastry.save()
    assert codes(quote(anon, shop.pastry)) == ["sold_out"]
    shop.pastry.is_sold_out = False
    shop.pastry.category.is_active = False
    shop.pastry.category.save()
    assert codes(quote(anon, shop.pastry)) == ["product_unavailable"]
    shop.beans.is_active = False
    shop.beans.save()
    assert quote(anon, shop.beans).status_code == 404  # archived products are not even visible


@pytest.mark.parametrize("qty", [0, 51, -1])
def test_quantity_out_of_range_is_reported(anon, shop, qty):
    r = quote(anon, shop.pastry, [], qty)
    assert r.status_code == 200 and codes(r) == ["invalid_quantity"]


@pytest.mark.parametrize("qty", ["abc", None, 2.5, True])
def test_non_integer_quantity_is_a_validation_error(anon, shop, qty):
    r = quote(anon, shop.pastry, [], qty)
    assert r.status_code == 400
    assert r.data["error"]["code"] == "validation_error"
    assert "quantity" in r.data["error"]["fields"]


def test_quote_limits_and_branch_availability(anon, shop):
    r = quote(anon, shop.beans, [], 11, branch_id=shop.branch.id)
    assert codes(r) == ["out_of_stock"]
    assert quote(anon, shop.beans, [], 10, branch_id=shop.branch.id).data["valid"] is True
    assert quote(anon, shop.beans, [], 1, branch_id=99999).status_code == 404


def test_option_ids_must_be_integers(anon, shop):
    r = anon.post(f"/api/v1/products/{shop.pastry.slug}/quote/", {"option_ids": ["x"], "quantity": 1}, format="json")
    assert r.status_code == 400
