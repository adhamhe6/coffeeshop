from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.utils import timezone

from apps.cart.tests.fixtures import add_to_cart, client_for, do_checkout, make_order
from apps.core.models import AuditLog
from apps.promotions.models import Coupon, CouponRedemption
from tests.factories import make_staff, make_user

pytestmark = pytest.mark.django_db
D = Decimal
VALIDATE = "/api/v1/coupons/validate/"
ADMIN = "/api/v1/admin/coupons/"


def make_coupon(code="SAVE", **kw):
    defaults = {"name": code.title(), "discount_type": "PERCENT", "value": D("10")}
    defaults.update(kw)
    cats = defaults.pop("categories", ())
    prods = defaults.pop("products", ())
    c = Coupon.objects.create(code=code, **defaults)
    c.categories.set(cats)
    c.products.set(prods)
    return c


def validate(client, code, **extra):
    return client.post(VALIDATE, {"code": code, **extra}, format="json")


# ── public validation ────────────────────────────────────────────────────────────────────────────────────────────────


def test_validate_returns_discount_preview_for_anonymous(anon, shop):
    make_coupon("WELCOME", description="Ten off", value=D("10"), min_order_total=D("5.00"), max_discount=D("3.00"))
    add_to_cart(anon, shop.beans, quantity=4)  # 50.00 -> 10% = 5.00 capped at 3.00
    r = validate(anon, "welcome", order_type="PICKUP", branch_id=shop.branch.id)
    assert r.status_code == 200, r.data
    assert r.data == {
        "valid": True,
        "code": "WELCOME",
        "name": "Welcome",
        "description": "Ten off",
        "discount_type": "PERCENT",
        "value": "10.00",
        "discount": "3.00",
        "subtotal": "50.00",
        "min_order_total": "5.00",
        "max_discount": "3.00",
    }


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({"is_active": False}, "not_found"),
        ({"ends_at": "past"}, "expired"),
        ({"starts_at": "future"}, "not_started"),
        ({"usage_limit": 2, "times_redeemed": 2}, "exhausted"),
        ({"min_order_total": D("99.00")}, "min_order_not_met"),
        ({"applies_to": "CATEGORIES"}, "not_eligible"),
    ],
)
def test_validate_failure_codes(anon, shop, kwargs, code):
    kwargs = dict(kwargs)
    if kwargs.get("ends_at") == "past":
        kwargs["ends_at"] = timezone.now() - timedelta(days=1)
    if kwargs.get("starts_at") == "future":
        kwargs["starts_at"] = timezone.now() + timedelta(days=1)
    if kwargs.get("applies_to") == "CATEGORIES":
        kwargs["categories"] = [shop.category]
    make_coupon("X1", **kwargs)
    add_to_cart(anon, shop.beans)  # beans are not in the 'Drinks' category
    r = validate(anon, "x1")
    assert r.status_code == 400 and r.data["error"]["code"] == code
    assert r.data["error"]["message"] and r.data["error"]["fields"]["code"]


def test_validate_unknown_code(anon, shop):
    add_to_cart(anon, shop.beans)
    r = validate(anon, "NOPE")
    assert r.status_code == 400 and r.data["error"]["code"] == "not_found"


def test_validate_needs_a_cart(anon, shop):
    make_coupon("X1")
    r = validate(anon, "X1")
    assert r.status_code == 400 and r.data["error"]["code"] == "cart_empty"


def test_min_order_failure_explains_the_threshold(anon, shop):
    make_coupon("BIG", min_order_total=D("40.00"))
    add_to_cart(anon, shop.beans)
    r = validate(anon, "BIG")
    assert r.data["error"]["code"] == "min_order_not_met" and r.data["error"]["min_order_total"] == "40.00"


def test_per_customer_and_first_order_codes_need_login_for_anonymous(anon, shop):
    make_coupon("LIM", per_customer_limit=1)
    make_coupon("FIRST", first_order_only=True)
    add_to_cart(anon, shop.beans)
    for code in ("LIM", "FIRST"):
        r = validate(anon, code)
        assert r.status_code == 401 and r.data["error"]["code"] == "login_required"


def test_per_customer_limit_for_signed_in_customer(auth, customer, shop):
    coupon = make_coupon("LIM", per_customer_limit=1)
    add_to_cart(auth, shop.beans)
    assert validate(auth, "LIM").status_code == 200
    order = make_order(shop, customer)
    CouponRedemption.objects.create(coupon=coupon, user=customer, order=order, discount_amount=D("1.00"))
    assert validate(auth, "LIM").data["error"]["code"] == "per_customer_limit"
    CouponRedemption.objects.update(is_voided=True)
    assert validate(auth, "LIM").status_code == 200


def test_first_order_only_blocks_returning_customers(auth, customer, shop):
    make_coupon("FIRST", first_order_only=True)
    add_to_cart(auth, shop.beans)
    assert validate(auth, "FIRST").status_code == 200
    make_order(shop, customer)
    r = validate(auth, "FIRST")
    assert r.status_code == 400 and r.data["error"]["code"] == "first_order_only"


def test_category_scoped_validation_only_counts_eligible_lines(anon, shop):
    make_coupon("DRINKS", value=D("50"), applies_to="CATEGORIES", categories=[shop.category])
    add_to_cart(anon, shop.latte, [shop.size_small.id], 2)
    add_to_cart(anon, shop.beans)
    r = validate(anon, "DRINKS")
    assert r.data["discount"] == "4.00" and r.data["subtotal"] == "20.50"


def test_validate_does_not_pick_automatic_promotions(anon, shop):
    make_coupon("AUTO", is_automatic=True, value=D("50"))
    add_to_cart(anon, shop.beans)
    assert validate(anon, "NOPE").status_code == 400


def test_validation_body_is_checked(anon, shop):
    assert anon.post(VALIDATE, {}, format="json").status_code == 400
    assert anon.post(VALIDATE, {"code": "x" * 41}, format="json").status_code == 400


def test_validate_is_throttled(anon, shop, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {**ScopedRateThrottle.THROTTLE_RATES, "coupon": "3/min"})
    cache.clear()
    add_to_cart(anon, shop.beans)
    codes = [validate(anon, "NOPE").status_code for _ in range(5)]
    assert codes[:3] == [400, 400, 400] and codes[3:] == [429, 429]
    cache.clear()


def test_checkout_applies_exactly_what_validate_promised(auth, shop):
    make_coupon("HALF", value=D("50"), max_discount=D("4.00"))
    add_to_cart(auth, shop.beans, quantity=2)
    promised = validate(auth, "half").data["discount"]
    r = do_checkout(auth, shop, coupon_code="half")
    assert r.data["order"]["discount_total"] == promised == "4.00"


# ── admin CRUD ───────────────────────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def marketing():
    return client_for(make_staff("MARKETING_MANAGER"))


def body(**kw):
    data = {"code": "spring25", "name": "Spring", "discount_type": "PERCENT", "value": "15.00"}
    data.update(kw)
    return data


def test_admin_authorization_matrix(anon, auth, shop):
    coupon = make_coupon("A1")
    for client, expected in [
        (anon, 401),
        (auth, 403),
        (client_for(make_staff("SUPPORT_AGENT")), 403),
        (client_for(make_staff("ORDER_MANAGER")), 403),
        (client_for(make_staff("PRODUCT_MANAGER")), 403),
    ]:
        assert client.get(ADMIN).status_code == expected
        assert client.post(ADMIN, body(), format="json").status_code == expected
        assert client.patch(f"{ADMIN}{coupon.id}/", {"name": "x"}, format="json").status_code == expected
        assert client.delete(f"{ADMIN}{coupon.id}/").status_code == expected
    for role in ("MARKETING_MANAGER", "ADMIN", "SUPER_ADMIN"):
        assert client_for(make_staff(role)).get(ADMIN).status_code == 200
    assert Coupon.objects.count() == 1 and Coupon.objects.get().name == "A1"


def test_create_coupon_normalizes_and_audits(marketing):
    r = marketing.post(
        ADMIN,
        body(min_order_total="10.00", usage_limit=100, per_customer_limit=1, first_order_only=True),
        format="json",
    )
    assert r.status_code == 201, r.data
    assert r.data["code"] == "SPRING25" and r.data["times_redeemed"] == 0
    assert r.data["total_discount"] == "0.00" and r.data["redemption_count"] == 0
    assert r.data["created_by_email"].startswith("marketing_manager")
    log = AuditLog.objects.get(action="coupon.create")
    assert log.resource_type == "promotions.Coupon" and log.changes["code"] == "SPRING25"
    assert log.actor.staff_profile.role == "MARKETING_MANAGER"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"value": "101"}, "value"),
        ({"value": "0"}, "value"),
        ({"discount_type": "FIXED", "value": "0"}, "value"),
        ({"code": "a b"}, "code"),
        ({"code": ""}, "code"),
        ({"starts_at": "2030-01-02T00:00:00Z", "ends_at": "2030-01-01T00:00:00Z"}, "ends_at"),
        ({"applies_to": "CATEGORIES"}, "category_ids"),
        ({"applies_to": "PRODUCTS"}, "product_ids"),
        ({"usage_limit": 0}, "usage_limit"),
        ({"per_customer_limit": 0}, "per_customer_limit"),
        ({"min_order_total": "-1"}, "min_order_total"),
    ],
)
def test_create_validation(marketing, override, field):
    r = marketing.post(ADMIN, body(**override), format="json")
    assert r.status_code == 400 and field in r.data["error"]["fields"], r.data
    assert Coupon.objects.count() == 0


def test_fixed_amount_may_exceed_100(marketing):
    r = marketing.post(ADMIN, body(discount_type="FIXED", value="250.00"), format="json")
    assert r.status_code == 201


def test_duplicate_code_is_rejected_case_insensitively(marketing):
    make_coupon("DUP")
    r = marketing.post(ADMIN, body(code="dup"), format="json")
    assert r.status_code == 400 and "code" in r.data["error"]["fields"]


def test_scoping_sets_are_enforced_and_cleared(marketing, shop):
    r = marketing.post(
        ADMIN,
        body(applies_to="CATEGORIES", category_ids=[shop.category.id], product_ids=[shop.beans.id]),
        format="json",
    )
    assert r.status_code == 201 and r.data["category_ids"] == [shop.category.id] and r.data["product_ids"] == []
    cid = r.data["id"]
    r = marketing.patch(f"{ADMIN}{cid}/", {"applies_to": "ALL"}, format="json")
    assert r.data["category_ids"] == [] and r.data["applies_to"] == "ALL"
    r = marketing.patch(f"{ADMIN}{cid}/", {"applies_to": "PRODUCTS"}, format="json")
    assert r.status_code == 400 and "product_ids" in r.data["error"]["fields"]
    r = marketing.patch(f"{ADMIN}{cid}/", {"applies_to": "PRODUCTS", "product_ids": [shop.beans.id]}, format="json")
    assert r.status_code == 200 and r.data["product_ids"] == [shop.beans.id]


def test_automatic_promotion_gets_a_generated_code(marketing):
    r = marketing.post(ADMIN, body(code="", is_automatic=True, name="Happy hour"), format="json")
    assert r.status_code == 201 and r.data["code"].startswith("AUTO-") and r.data["is_automatic"] is True


def test_update_audits_diff_and_activation(marketing):
    coupon = make_coupon("UPD", value=D("10"))
    r = marketing.patch(f"{ADMIN}{coupon.id}/", {"value": "20.00", "is_active": False}, format="json")
    assert r.status_code == 200 and r.data["value"] == "20.00" and r.data["is_active"] is False
    update = AuditLog.objects.get(action="coupon.update")
    assert update.changes["value"] == ["10.00", "20.00"] and update.changes["is_active"] == [True, False]
    assert AuditLog.objects.filter(action="coupon.deactivate").count() == 1
    marketing.patch(f"{ADMIN}{coupon.id}/", {"is_active": True}, format="json")
    assert AuditLog.objects.filter(action="coupon.activate").count() == 1
    marketing.patch(f"{ADMIN}{coupon.id}/", {"is_active": True}, format="json")  # no change -> no extra audit rows
    assert AuditLog.objects.filter(action__startswith="coupon.").count() == 4


def test_usage_limit_cannot_drop_below_redemptions(marketing):
    coupon = make_coupon("USED", usage_limit=5, times_redeemed=3)
    r = marketing.patch(f"{ADMIN}{coupon.id}/", {"usage_limit": 2}, format="json")
    assert r.status_code == 400 and "usage_limit" in r.data["error"]["fields"]
    assert marketing.patch(f"{ADMIN}{coupon.id}/", {"usage_limit": 3}, format="json").status_code == 200


def test_put_replaces_and_validates_against_existing_values(marketing):
    coupon = make_coupon("PUT")
    r = marketing.put(f"{ADMIN}{coupon.id}/", body(code="PUT", value="5.00"), format="json")
    assert r.status_code == 200 and r.data["value"] == "5.00"


def test_delete_unredeemed_coupon_and_audit(marketing):
    coupon = make_coupon("GONE")
    assert marketing.delete(f"{ADMIN}{coupon.id}/").status_code == 204
    assert not Coupon.objects.filter(pk=coupon.pk).exists()
    assert AuditLog.objects.filter(action="coupon.delete", resource_id=str(coupon.pk)).exists()
    assert marketing.delete(f"{ADMIN}{coupon.id}/").status_code == 404


def test_delete_redeemed_coupon_conflicts_and_must_be_deactivated(marketing, customer, shop):
    coupon = make_coupon("USED", times_redeemed=1)
    CouponRedemption.objects.create(
        coupon=coupon, user=customer, order=make_order(shop, customer), discount_amount=D("1.00"), is_voided=True
    )
    r = marketing.delete(f"{ADMIN}{coupon.id}/")
    assert r.status_code == 409 and r.data["error"]["code"] == "coupon_has_redemptions"
    assert Coupon.objects.filter(pk=coupon.pk).exists()
    assert marketing.patch(f"{ADMIN}{coupon.id}/", {"is_active": False}, format="json").status_code == 200


def test_stats_count_only_live_redemptions(marketing, customer, shop):
    coupon = make_coupon("STAT", times_redeemed=2)
    for amount, voided in (("2.50", False), ("1.25", False), ("9.99", True)):
        CouponRedemption.objects.create(
            coupon=coupon, user=customer, order=make_order(shop, customer), discount_amount=D(amount), is_voided=voided
        )
    detail = marketing.get(f"{ADMIN}{coupon.id}/").data
    assert detail["total_discount"] == "3.75" and detail["redemption_count"] == 2 and detail["times_redeemed"] == 2
    listed = marketing.get(ADMIN).data["results"][0]
    assert listed["total_discount"] == "3.75"


def test_list_filters_search_and_ordering(marketing):
    make_coupon("ALPHA", is_active=True)
    make_coupon("BETA", is_active=False)
    make_coupon("GAMMA", is_automatic=True, name="Happy hour")
    assert marketing.get(ADMIN).data["count"] == 3
    assert [c["code"] for c in marketing.get(ADMIN + "?is_active=false").data["results"]] == ["BETA"]
    assert [c["code"] for c in marketing.get(ADMIN + "?is_automatic=true").data["results"]] == ["GAMMA"]
    assert [c["code"] for c in marketing.get(ADMIN + "?q=happy").data["results"]] == ["GAMMA"]
    assert [c["code"] for c in marketing.get(ADMIN + "?q=alp").data["results"]] == ["ALPHA"]
    assert [c["code"] for c in marketing.get(ADMIN + "?ordering=code").data["results"]] == ["ALPHA", "BETA", "GAMMA"]


def test_end_to_end_admin_coupon_used_by_customer(marketing, auth, shop):
    cid = marketing.post(ADMIN, body(code="E2E", value="20.00", usage_limit=1), format="json").data["id"]
    add_to_cart(auth, shop.beans)
    assert do_checkout(auth, shop, coupon_code="e2e").status_code == 201
    detail = marketing.get(f"{ADMIN}{cid}/").data
    assert detail["times_redeemed"] == 1 and detail["total_discount"] == "2.50" and detail["redemption_count"] == 1
    other = client_for(make_user())
    add_to_cart(other, shop.beans)
    assert validate(other, "E2E").data["error"]["code"] == "exhausted"
