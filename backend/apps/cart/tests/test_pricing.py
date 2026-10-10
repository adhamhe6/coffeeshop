from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.cart.pricing import LineInput, distribute, price_cart
from apps.cart.selection import selection_signature
from apps.core.models import StoreSettings
from apps.orders.models import Order
from apps.promotions.models import Coupon, CouponRedemption
from tests.factories import make_branch, make_product, make_user, make_zone

pytestmark = pytest.mark.django_db

D = Decimal


def line(product, qty=1, options=()):
    return LineInput(product, tuple(options), qty)


def make_coupon(code="SAVE", **kw):
    defaults = {"name": code, "discount_type": "PERCENT", "value": D("10")}
    defaults.update(kw)
    cats = defaults.pop("categories", ())
    prods = defaults.pop("products", ())
    coupon = Coupon.objects.create(code=code, **defaults)
    coupon.categories.set(cats)
    coupon.products.set(prods)
    return coupon


def settings_with(tax="0.00", inclusive=False):
    s = StoreSettings.load()
    s.tax_rate, s.prices_include_tax = D(tax), inclusive
    s.save()
    return s


def run(lines, **kw):
    kw.setdefault("check_availability", False)
    kw.setdefault("automatic", [])
    return price_cart(lines, **kw)


# ── lines, tax, rounding ─────────────────────────────────────────────────────────────────────────────────────────────


def test_unit_price_adds_option_deltas(shop):
    result = run([line(shop.latte, 2, [shop.size_large, shop.oat, shop.soy])], settings=settings_with())
    item = result.lines[0]
    assert item.base_price == D("4.00")
    assert item.unit_price == D("6.00")
    assert item.line_total == D("12.00")
    assert result.subtotal == D("12.00") and result.total == D("12.00")
    assert result.tax_total == D("0.00") and result.discount_total == D("0.00") and result.delivery_fee == D("0.00")
    assert not result.issues


def test_tax_exclusive_rounds_half_up_on_three_times_3_33(shop):
    result = run([line(shop.pastry, 3)], settings=settings_with("8.25"))
    assert result.subtotal == D("9.99")
    assert result.tax_total == D("0.82")  # 9.99 x 8.25% = 0.824175
    assert result.total == D("10.81")


def test_tax_inclusive_extracts_tax_and_keeps_total(shop):
    result = run([line(shop.pastry, 3)], settings=settings_with("8.25", inclusive=True))
    assert result.subtotal == D("9.99")
    assert result.tax_total == D("0.76")  # 9.99 x 8.25 / 108.25 = 0.76135
    assert result.total == D("9.99")
    assert result.prices_include_tax is True


@pytest.mark.parametrize(
    ("price", "rate", "expected_tax"),
    [("0.10", "5.00", "0.01"), ("0.30", "5.00", "0.02"), ("1.00", "8.25", "0.08"), ("2.00", "8.25", "0.17")],
)
def test_tax_half_up_edges(price, rate, expected_tax):
    product = make_product(price=price)
    result = run([line(product)], settings=settings_with(rate))
    # 0.10 x 5% = 0.005 -> 0.01 (half-up); 0.30 x 5% = 0.015 -> 0.02; 1.00 x 8.25% = 0.0825 -> 0.08; 2.00 x 8.25% = 0.165 -> 0.17
    assert result.tax_total == D(expected_tax)


def test_zero_price_product_totals_zero(shop):
    free = make_product("Free sample", "0.00", shop.category)
    result = run([line(free, 3)], settings=settings_with("8.25"))
    assert result.subtotal == D("0.00") and result.tax_total == D("0.00") and result.total == D("0.00")


def test_negative_option_delta_never_makes_unit_price_negative(shop):
    from apps.catalog.models import ModifierOption

    product = make_product("Cheap", "0.30", shop.category)
    group = shop.size_small.group
    option = ModifierOption.objects.create(group=group, name="Discount", price_delta=D("-1.00"))
    result = run([LineInput(product, (option,), 1)])
    assert result.lines[0].unit_price == D("0.00")


def test_empty_cart_reports_issue():
    result = run([])
    assert result.total == D("0.00")
    assert [i.code for i in result.issues] == ["cart_empty"]


def test_price_changed_flag_when_seen_price_differs(shop):
    seen = LineInput(shop.pastry, (), 1, key=7, unit_price_seen=D("3.00"))
    result = run([seen])
    assert result.lines[0].price_changed == {"was": D("3.00"), "now": D("3.33")}
    codes = {(i.code, i.severity) for i in result.issues}
    assert ("price_changed", "warning") in codes
    assert not result.blocking_issues


def test_signature_is_stable_and_order_independent():
    assert selection_signature(1, [3, 2]) == selection_signature(1, [2, 3, 3])
    assert selection_signature(1, [2]) != selection_signature(2, [2])
    assert len(selection_signature(1, [])) == 40


# ── coupons ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_percent_coupon_with_tax(shop):
    coupon = make_coupon(value=D("10"))
    result = run([line(shop.pastry, 3)], coupon=coupon, settings=settings_with("8.25"))
    assert result.discount_total == D("1.00")  # 0.999 -> 1.00
    assert result.lines[0].discount == D("1.00")
    assert result.tax_total == D("0.74")  # (9.99 - 1.00) x 8.25% = 0.741675
    assert result.total == D("9.73")
    assert result.applied_coupon == coupon


def test_fixed_coupon_never_exceeds_subtotal(shop):
    coupon = make_coupon(discount_type="FIXED", value=D("10.00"))
    result = run([line(shop.pastry)], coupon=coupon, settings=settings_with("8.25"))
    assert result.discount_total == D("3.33")
    assert result.total == D("0.00") and result.tax_total == D("0.00")


def test_percent_100_makes_order_free(shop):
    coupon = make_coupon(value=D("100"))
    result = run([line(shop.latte, 1, [shop.size_small])], coupon=coupon)
    assert result.total == D("0.00") and result.discount_total == D("4.00")


def test_max_discount_cap(shop):
    coupon = make_coupon(value=D("50"), max_discount=D("2.00"))
    result = run([line(shop.beans, 2)], coupon=coupon)  # 25.00 -> 12.50 capped at 2.00
    assert result.discount_total == D("2.00")
    assert result.total == D("23.00")


def test_fixed_coupon_with_cap_below_value(shop):
    coupon = make_coupon(discount_type="FIXED", value=D("5.00"), max_discount=D("3.00"))
    assert run([line(shop.beans, 2)], coupon=coupon).discount_total == D("3.00")


def test_category_scoped_discount_only_hits_eligible_lines(shop):
    coupon = make_coupon(value=D("50"), applies_to="CATEGORIES", categories=[shop.category])
    result = run([line(shop.latte, 2, [shop.size_small]), line(shop.pastry)], coupon=coupon)
    drinks, bakery = result.lines
    assert drinks.discount == D("4.00") and bakery.discount == D("0.00")
    assert result.discount_total == D("4.00")
    assert result.total == D("11.33") - D("4.00")


def test_product_scoped_fixed_discount_capped_at_eligible_amount(shop):
    coupon = make_coupon(discount_type="FIXED", value=D("20.00"), applies_to="PRODUCTS", products=[shop.pastry])
    result = run([line(shop.latte, 1, [shop.size_small]), line(shop.pastry, 2)], coupon=coupon)
    assert result.discount_total == D("6.66")
    assert result.lines[0].discount == D("0.00")


def test_min_order_total_is_checked_against_eligible_subtotal(shop):
    coupon = make_coupon(value=D("10"), applies_to="CATEGORIES", categories=[shop.category], min_order_total=D("10.00"))
    # total cart is 12.33 but only 4.00 of it is in the eligible category
    result = run([line(shop.latte, 1, [shop.size_small]), line(shop.beans)], coupon=coupon)
    assert result.coupon_error.code == "min_order_not_met"
    assert result.discount_total == D("0.00") and result.applied_coupon is None


def test_distribution_sums_exactly():
    assert sum(distribute(D("1.00"), [D("1.00"), D("1.00"), D("1.00")])) == D("1.00")
    parts = distribute(D("1.00"), [D("1.00"), D("1.00"), D("1.00")])
    assert parts == [D("0.34"), D("0.33"), D("0.33")]
    assert distribute(D("0.00"), [D("5.00")]) == [D("0.00")]
    assert sum(distribute(D("2.51"), [D("3.33"), D("9.99"), D("0.01")])) == D("2.51")


def test_line_discounts_sum_to_total_discount(shop):
    coupon = make_coupon(discount_type="FIXED", value=D("1.00"))
    a, b, c = (make_product(f"P{i}", "1.00", shop.category) for i in range(3))
    result = run([line(a), line(b), line(c)], coupon=coupon)
    assert sum(ln.discount for ln in result.lines) == result.discount_total == D("1.00")


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({"is_active": False}, "not_found"),
        ({"starts_at": "future"}, "not_started"),
        ({"ends_at": "past"}, "expired"),
        ({"usage_limit": 1, "times_redeemed": 1}, "exhausted"),
        ({"min_order_total": D("100.00")}, "min_order_not_met"),
    ],
)
def test_coupon_rejections(shop, kwargs, code):
    now = timezone.now()
    kwargs = dict(kwargs)
    if kwargs.get("starts_at") == "future":
        kwargs["starts_at"] = now + timedelta(days=1)
    if kwargs.get("ends_at") == "past":
        kwargs["ends_at"] = now - timedelta(minutes=1)
    coupon = make_coupon(**kwargs)
    result = run([line(shop.pastry)], coupon=coupon)
    assert result.coupon_error.code == code
    assert result.discount_total == D("0.00")


def test_unknown_code_is_not_found(shop):
    result = run([line(shop.pastry)], coupon_code="NOPE")
    assert result.coupon_error.code == "not_found"


def test_code_lookup_is_case_insensitive(shop):
    make_coupon("Spring10")
    result = run([line(shop.pastry)], coupon_code=" spring10 ")
    assert result.applied_coupon.code == "SPRING10"


def test_not_eligible_when_no_matching_lines(shop):
    coupon = make_coupon(applies_to="CATEGORIES", categories=[shop.category])
    result = run([line(shop.beans)], coupon=coupon)
    assert result.coupon_error.code == "not_eligible"


def test_per_customer_limit_counts_only_non_voided_redemptions(shop):
    user = make_user()
    coupon = make_coupon(per_customer_limit=1)
    order = _bare_order(user, shop)
    redemption = CouponRedemption.objects.create(coupon=coupon, user=user, order=order, discount_amount=D("1.00"))
    assert run([line(shop.pastry)], coupon=coupon, user=user).coupon_error.code == "per_customer_limit"
    redemption.is_voided = True
    redemption.save()
    assert run([line(shop.pastry)], coupon=coupon, user=user).applied_coupon == coupon


def test_per_customer_and_first_order_coupons_need_login(shop):
    limited = make_coupon("LIM", per_customer_limit=2)
    first = make_coupon("FIRST", first_order_only=True)
    assert run([line(shop.pastry)], coupon=limited).coupon_error.code == "login_required"
    assert run([line(shop.pastry)], coupon=first).coupon_error.code == "login_required"


def test_first_order_only(shop):
    user = make_user()
    coupon = make_coupon(first_order_only=True)
    assert run([line(shop.pastry)], coupon=coupon, user=user).applied_coupon == coupon
    order = _bare_order(user, shop)
    assert run([line(shop.pastry)], coupon=coupon, user=user).coupon_error.code == "first_order_only"
    order.status = Order.Status.CANCELLED  # a cancelled order does not use up the first-order privilege
    order.save()
    assert run([line(shop.pastry)], coupon=coupon, user=user).applied_coupon == coupon


# ── automatic promotions ─────────────────────────────────────────────────────────────────────────────────────────────


def test_best_automatic_promotion_wins_without_stacking(shop):
    small = make_coupon("AUTO5", is_automatic=True, value=D("5"))
    big = make_coupon("AUTO15", is_automatic=True, value=D("15"))
    result = price_cart([line(shop.beans, 2)], check_availability=False, automatic=[small, big])
    assert result.applied_coupon == big
    assert result.discount_total == D("3.75")


def test_automatic_ignored_when_ineligible(shop):
    promo = make_coupon("AUTO", is_automatic=True, min_order_total=D("100.00"))
    result = price_cart([line(shop.beans)], check_availability=False, automatic=[promo])
    assert result.applied_coupon is None and result.coupon_error is None


def test_typed_coupon_replaces_automatic(shop):
    auto = make_coupon("AUTO", is_automatic=True, value=D("50"))
    typed = make_coupon("TYPED", value=D("10"))
    result = price_cart([line(shop.beans, 2)], coupon=typed, check_availability=False, automatic=[auto])
    assert result.applied_coupon == typed
    assert result.discount_total == D("2.50")


def test_invalid_typed_code_reports_error_but_automatic_still_applies(shop):
    auto = make_coupon("AUTO", is_automatic=True, value=D("10"))
    result = price_cart([line(shop.beans, 2)], coupon_code="NOPE", check_availability=False, automatic=[auto])
    assert result.coupon_error.code == "not_found"
    assert result.applied_coupon == auto


def test_automatic_promotions_are_loaded_from_db_by_default(shop):
    make_coupon("AUTO", is_automatic=True, value=D("10"))
    make_coupon("PLAIN", is_automatic=False, value=D("90"))
    result = price_cart([line(shop.beans, 2)], check_availability=False)
    assert result.applied_coupon.code == "AUTO"


# ── delivery ─────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_delivery_fee_added_and_not_taxed(shop):
    result = run(
        [line(shop.beans, 2)],
        branch=shop.branch,
        order_type="DELIVERY",
        zone=shop.zone,
        settings=settings_with("10.00"),
    )
    assert result.delivery_fee == D("3.00")
    assert result.tax_total == D("2.50")
    assert result.total == D("30.50")  # 25.00 + 2.50 tax + 3.00 delivery
    assert result.delivery.eta_minutes == 30


def test_delivery_fee_with_inclusive_tax_excludes_fee_from_tax(shop):
    result = run(
        [line(shop.beans, 2)],
        branch=shop.branch,
        order_type="DELIVERY",
        zone=shop.zone,
        settings=settings_with("10.00", inclusive=True),
    )
    assert result.tax_total == D("2.27")  # 25.00 x 10 / 110
    assert result.total == D("28.00")


def test_pickup_has_no_delivery_fee(shop):
    result = run([line(shop.beans)], branch=shop.branch, order_type="PICKUP", zone=shop.zone)
    assert result.delivery_fee == D("0.00") and result.delivery is None


def test_free_delivery_over_threshold_and_minimum(db, store_settings):
    branch = make_branch("FD", delivery=True)
    zone = make_zone("Far", branch=branch, fee="4.00", min_order="10.00", free_over="30.00")
    cheap = make_product("Cheap", "5.00")
    mid = make_product("Mid", "12.00")
    big = make_product("Big", "30.00")
    below = run([line(cheap)], branch=branch, order_type="DELIVERY", zone=zone)
    assert [i.code for i in below.blocking_issues] == ["below_delivery_minimum"]
    assert below.delivery_fee == D("0.00")
    assert run([line(mid)], branch=branch, order_type="DELIVERY", zone=zone).delivery_fee == D("4.00")
    assert run([line(big)], branch=branch, order_type="DELIVERY", zone=zone).delivery_fee == D("0.00")


def test_delivery_to_unserved_zone_is_a_blocking_issue(shop):
    other = make_zone("Elsewhere")
    result = run([line(shop.beans)], branch=shop.branch, order_type="DELIVERY", zone=other)
    assert [i.code for i in result.blocking_issues] == ["zone_not_served"]
    result = run([line(shop.beans)], branch=shop.branch, order_type="DELIVERY", zone=None)
    assert [i.code for i in result.blocking_issues] == ["zone_not_served"]


def test_availability_issues_for_stock_and_branch_toggle(shop):
    from apps.inventory.models import BranchProduct

    too_many = price_cart([line(shop.beans, 11)], branch=shop.branch, automatic=[])
    assert [i.code for i in too_many.blocking_issues] == ["out_of_stock"]
    # quantities of the same product on different lines add up
    split = price_cart(
        [LineInput(shop.beans, (), 6, key=1), LineInput(shop.beans, (shop.oat,), 6, key=2)],
        branch=shop.branch,
        automatic=[],
    )
    assert "out_of_stock" in {i.code for i in split.blocking_issues}
    BranchProduct.objects.create(branch=shop.branch, product=shop.pastry, is_available=False)
    off = price_cart([line(shop.pastry)], branch=shop.branch, automatic=[])
    assert "branch_unavailable" in {i.code for i in off.blocking_issues}


def _bare_order(user, shop):
    return Order.objects.create(
        number=f"X-{user.pk}-{Order.objects.count()}",
        customer=user,
        branch=shop.branch,
        order_type="PICKUP",
        payment_method="cash",
        currency="USD",
        subtotal=D("1.00"),
        total=D("1.00"),
        customer_name="T",
        customer_email=user.email,
        idempotency_key=f"k-{user.pk}-{Order.objects.count()}",
        placed_at=timezone.now(),
    )


def test_pricing_invariants_hold_for_random_carts(shop):
    import random

    rng = random.Random(20261010)
    products = [make_product(f"R{i}", f"{rng.randint(1, 4000) / 100:.2f}", shop.category) for i in range(8)]
    for round_ in range(150):
        lines = [line(rng.choice(products), rng.randint(1, 7)) for _ in range(rng.randint(1, 5))]
        kind = rng.choice(["PERCENT", "FIXED"])
        value = D(rng.randint(1, 100)) if kind == "PERCENT" else D(rng.randint(1, 8000)) / 100
        coupon = Coupon(
            code=f"R{round_}",
            name="r",
            discount_type=kind,
            value=value,
            max_discount=D(rng.randint(1, 3000)) / 100 if rng.random() < 0.4 else None,
        )
        rate = D(rng.choice(["0", "5", "7.25", "8.25", "19", "20"]))
        inclusive = rng.random() < 0.5
        result = run(lines, coupon=coupon, settings=settings_with(rate, inclusive))
        assert result.subtotal == sum(ln.line_total for ln in result.lines)
        assert D("0") <= result.discount_total <= result.subtotal
        assert sum(ln.discount for ln in result.lines) == result.discount_total
        assert all(D("0") <= ln.discount <= ln.line_total for ln in result.lines)
        taxable = result.subtotal - result.discount_total
        assert result.total == (taxable if inclusive else taxable + result.tax_total)
        assert result.total >= 0 and result.tax_total >= 0
        assert result.total == result.total.quantize(D("0.01"))
