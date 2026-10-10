"""Each report's content, and reconciliation of every report's totals with the dashboard KPIs for the same filters."""

from collections import defaultdict
from decimal import Decimal as D

import pytest

from .conftest import D_FROM, D_TO
from .helpers import COFFEE, ZERO, make_coupon, make_order, utc

pytestmark = pytest.mark.django_db

PARAMS = {"date_from": D_FROM.isoformat(), "date_to": D_TO.isoformat()}
SCOPES = [{}, {"date_to": "2026-09-14"}, {"branch": "A"}, {"branch": "B"}, {"branch": "C"}]


def call(get, user, path, **params):
    r = get(user, f"admin/reports/{path}/", **{**PARAMS, **params})
    assert r.status_code == 200, r.content
    return r.json()


def dash(get, user, **params):
    r = get(user, "admin/dashboard/", **{**PARAMS, **params})
    assert r.status_code == 200, r.content
    return r.json()


def money(value):
    return D(value)


@pytest.fixture(params=range(len(SCOPES)), ids=lambda i: str(SCOPES[i]))
def scope(request, world):
    raw = dict(SCOPES[request.param])
    if "branch" in raw:
        raw["branch"] = {"A": world.a, "B": world.b, "C": world.c}[raw["branch"]].pk
    return raw


# ── reconciliation ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_every_report_total_reconciles_with_dashboard_kpis(world, get, scope):
    admin = world.users.admin
    d = dash(get, admin, **scope)
    k = {name: v["value"] for name, v in d["kpis"].items()}
    att = d["attention"]

    sales = call(get, admin, "sales", **scope)["totals"]
    for key in (
        "gross_sales",
        "discounts",
        "delivery_fees",
        "tax",
        "refunds",
        "net_sales",
        "revenue_collected",
        "average_order_value",
    ):
        assert sales[key] == k[key], key
    assert sales["orders"] == k["orders_counted"]

    status = call(get, admin, "orders-by-status", **scope)
    assert status["totals"] == {key: k[key] for key in status["totals"]}
    assert {r["status"]: r["count"] for r in status["results"]} == {
        r["status"]: r["count"] for r in d["orders_by_status"]
    }

    for name in ("products", "categories"):
        t = call(get, admin, name, **scope)["totals"]
        assert t["gross"] == k["gross_sales"], name
        assert t["discounts"] == k["discounts"], name
        assert money(t["net"]) == money(k["net_sales"]) + money(k["refunds"]), (
            name
        )  # refunds are not allocated to items
        assert t["orders"] == k["orders_counted"], name

    br = call(get, admin, "branches", **scope)
    for key, kk in (("orders", "orders_counted"), ("orders_total", "orders_total")):
        assert br["totals"][key] == k[kk]
    for key in ("gross_sales", "discounts", "refunds", "net_sales", "revenue_collected", "average_order_value"):
        assert br["totals"][key] == k[key], key

    promo = call(get, admin, "promotions", **scope)["totals"]
    assert promo["discounts"] == k["discounts"] and promo["orders_counted"] == k["orders_counted"]

    assert call(get, admin, "payments", **scope)["totals"]["payment_failures"] == k["payment_failures"]

    refunds = call(get, admin, "refunds", **scope)["totals"]
    assert refunds["refunds"] == k["refunds"]
    assert refunds["refund_needed_orders"] == att["refund_needed"]

    inv = call(get, admin, "inventory", **scope)["totals"]
    assert inv["low_stock_products"] == k["low_stock_products"]
    assert inv["out_of_stock_products"] == k["out_of_stock_products"]

    cust = call(get, admin, "customers", **scope)["totals"]
    assert cust["orders"] == k["orders_counted"]
    assert cust["revenue_collected"] == k["revenue_collected"]
    assert cust["net_sales"] == k["net_sales"]


def test_sales_report_buckets_match_dashboard_series(world, get):
    sales = call(get, world.users.admin, "sales")
    series = dash(get, world.users.admin)["series"]
    assert sales["results"] == series
    weekly = call(get, world.users.admin, "sales", granularity="week")
    assert [r["bucket"] for r in weekly["results"]][0] == "2026-09-01"
    assert weekly["totals"] == sales["totals"]


# ── orders by status ───────────────────────────────────────────────────────────────────────────────────────────────
def test_orders_by_status_lists_every_status(world, get):
    data = call(get, world.users.admin, "orders-by-status")
    assert [r["status"] for r in data["results"]] == [
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "READY_FOR_PICKUP",
        "OUT_FOR_DELIVERY",
        "COMPLETED",
        "CANCELLED",
    ]
    expected = world.expected.by_status(D_FROM, D_TO)
    assert {r["status"]: r["count"] for r in data["results"] if r["count"]} == expected
    assert data["totals"]["orders_total"] == 15 and data["totals"]["orders_pending"] == 6


# ── products / categories ──────────────────────────────────────────────────────────────────────────────────────────
def item_oracle(world, branch_ids=None):
    prod = defaultdict(lambda: {"units": 0, "gross": ZERO, "disc": ZERO, "orders": set()})
    for s in world.expected.window(D_FROM, D_TO, branch_ids):
        if s.counted:
            for ln in s.lines:
                p = prod[ln.sku]
                p["units"] += ln.qty
                p["gross"] += ln.total
                p["disc"] += ln.discount
                p["orders"].add(s.order.pk)
    return prod


def test_products_report_rows_match_oracle_and_sort(world, get):
    data = call(get, world.users.admin, "products", ordering="-units")
    prod = item_oracle(world)
    assert data["count"] == len(prod) == 3
    rows = {r["sku"]: r for r in data["results"]}
    for sku, e in prod.items():
        r = rows[sku]
        assert r["units"] == e["units"] and money(r["gross"]) == e["gross"] and money(r["discounts"]) == e["disc"]
        assert money(r["net"]) == e["gross"] - e["disc"] and r["orders"] == len(e["orders"])
    assert [r["units"] for r in data["results"]] == sorted((e["units"] for e in prod.values()), reverse=True)
    assert abs(sum(r["share"] for r in data["results"]) - 100) < 0.2
    by_name = call(get, world.users.admin, "products", ordering="name")
    assert [r["product_name"] for r in by_name["results"]] == sorted(r["product_name"] for r in by_name["results"])


def test_products_report_is_paginated_with_totals_on_every_page(world, get):
    page1 = call(get, world.users.admin, "products", page_size=2, ordering="-net")
    assert page1["count"] == 3 and len(page1["results"]) == 2 and page1["next"] and page1["previous"] is None
    page2 = call(get, world.users.admin, "products", page_size=2, page=2, ordering="-net")
    assert len(page2["results"]) == 1 and page2["totals"] == page1["totals"]


def test_products_report_rejects_unknown_ordering(world, get):
    r = get(world.users.admin, "admin/reports/products/", ordering="bogus")
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"


def test_categories_report(world, get):
    data = call(get, world.users.admin, "categories")
    prod = item_oracle(world)
    cats = {"COF-1": "Coffee", "BEA-1": "Beans", "CAK-1": "Food"}
    by_cat = defaultdict(lambda: ZERO)
    for sku, e in prod.items():
        by_cat[cats[sku]] += e["gross"] - e["disc"]
    assert {r["category"]: money(r["net"]) for r in data["results"]} == dict(by_cat)
    nets = [money(r["net"]) for r in data["results"]]
    assert nets == sorted(nets, reverse=True)


def test_blank_category_snapshot_is_reported_as_uncategorised(world, get):
    from apps.orders.models import OrderItem

    OrderItem.objects.filter(sku="CAK-1").update(category_name="")
    data = call(get, world.users.admin, "categories")
    assert "Uncategorised" in {r["category"] for r in data["results"]}


# ── branches ───────────────────────────────────────────────────────────────────────────────────────────────────────
def test_branches_report(world, get):
    data = call(get, world.users.admin, "branches")
    assert {r["branch"] for r in data["results"]} == {"Downtown", "Tokyo", "New York"}
    tokyo = next(r for r in data["results"] if r["branch"] == "Tokyo")
    exp = world.expected.kpis(D_FROM, D_TO, {world.b.pk})
    assert tokyo["orders"] == exp["orders_counted"] == 2 and tokyo["orders_total"] == 2
    assert money(tokyo["net_sales"]) == exp["net_sales"] == D("42.00")
    assert tokyo["timezone"] == "Asia/Tokyo"
    nets = [money(r["net_sales"]) for r in data["results"]]
    assert nets == sorted(nets, reverse=True)


# ── promotions ─────────────────────────────────────────────────────────────────────────────────────────────────────
def test_promotions_report_counts_non_voided_redemptions(world, get):
    cust = world.customers[1]
    # cancelled order that used the coupon: its redemption is voided and must not count
    make_order(
        world.a,
        cust,
        utc(2026, 9, 21, 9),
        [COFFEE(2, "0.70")],
        status="CANCELLED",
        payment_status="PENDING",
        coupon=world.coupon,
    )
    # a second coupon that was redeemed on an order still awaiting payment: redeemed, not (yet) a sale
    spring = make_coupon("SPRING", name="Spring", discount_type="FIXED", value=D("1.00"))
    make_order(
        world.a,
        cust,
        utc(2026, 9, 22, 9),
        [COFFEE(2, "1.00")],
        status="PENDING",
        payment_status="PENDING",
        coupon=spring,
    )
    data = call(get, world.users.admin, "promotions")
    rows = {r["code"]: r for r in data["results"]}
    assert rows["SAVE10"]["redemptions"] == 1
    assert money(rows["SAVE10"]["discount_given"]) == D("2.10")
    assert rows["SAVE10"]["orders"] == 1
    assert money(rows["SAVE10"]["revenue_influenced"]) == D("18.90")  # 21.00 items - 2.10
    assert rows["SPRING"]["redemptions"] == 1 and rows["SPRING"]["orders"] == 0
    assert money(rows["SPRING"]["discount_given"]) == D("1.00") and money(rows["SPRING"]["revenue_influenced"]) == ZERO
    t = data["totals"]
    assert t["redemptions"] == 2 and money(t["discount_given"]) == D("3.10") and t["orders"] == 1
    assert [r["code"] for r in data["results"]] == ["SAVE10", "SPRING"]  # by discount given


# ── payments ───────────────────────────────────────────────────────────────────────────────────────────────────────
def test_payments_report_by_provider_and_status(world, get):
    data = call(get, world.users.admin, "payments")
    t = data["totals"]
    # window: every order with a payment row created in range, plus the extra stripe failure
    rows = {(r["provider"], r["status"], r["is_sandbox"]): r for r in data["results"]}
    assert rows[("stripe", "FAILED", False)]["count"] == 1
    assert rows[("demo", "FAILED", True)]["count"] == 1
    assert t["payment_failures"] == 2
    assert t["includes_sandbox"] is True and t["sandbox_payments"] > 0
    assert sum(r["count"] for r in data["results"]) == t["payments"]
    assert money(t["collected_amount"]) == money(t["settled_amount"]) - money(t["refunded_amount"])
    assert t["failure_rate"] == round(2 * 100 / t["payments"], 1)
    assert data["failures"][0]["count"] >= 1
    assert {f["failure_code"] for f in data["failures"]} == {"", "card_declined"}


def test_payments_report_without_sandbox_flag(world, get):
    from apps.payments.models import Payment

    Payment.objects.update(is_sandbox=False)
    assert call(get, world.users.admin, "payments")["totals"]["includes_sandbox"] is False


# ── refunds ────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_refunds_report_rows_cancellations_and_totals(world, get):
    data = call(get, world.users.admin, "refunds")
    rows = {r["order_number"]: r for r in data["results"]}
    refunded = world.expected.specs[6].order.number
    partial = world.expected.specs[7].order.number
    cancelled_paid = world.expected.specs[4].order.number
    assert set(rows) == {refunded, partial, cancelled_paid}
    assert money(rows[refunded]["amount"]) == D("14.00") and rows[refunded]["counted_in_sales"] is True
    assert rows[cancelled_paid]["counted_in_sales"] is False and rows[cancelled_paid]["status"] == "PENDING"
    t = data["totals"]
    assert money(t["refunded_amount"]) == D("16.00")  # succeeded only
    assert money(t["pending_amount"]) == D("5.00")
    assert t["refund_rows"] == 3 and t["failed_refunds"] == 0
    assert money(t["refunds"]) == D("16.00")  # = dashboard KPI (counted orders only)
    assert t["cancelled_orders"] == 1 and money(t["cancelled_value"]) == D("28.00")
    assert t["cancelled_paid_unrefunded"] == 1 and money(t["cancelled_unrefunded_amount"]) == D("28.00")
    assert t["refund_needed_orders"] == 1
    cancelled = data["cancellations"]
    assert [c["number"] for c in cancelled] == [cancelled_paid]
    assert cancelled[0]["refund_needed"] is True and money(cancelled[0]["amount_to_refund"]) == D("28.00")
    assert cancelled[0]["cancel_reason"]


def test_refund_needed_clears_once_fully_refunded(world, get):
    from apps.orders.models import Order

    Order.objects.filter(pk=world.expected.specs[4].order.pk).update(
        refunded_total=D("28.00"), payment_status="REFUNDED"
    )
    data = call(get, world.users.admin, "refunds")
    assert data["totals"]["refund_needed_orders"] == 0
    assert dash(get, world.users.admin)["attention"]["refund_needed"] == 0


# ── inventory ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_inventory_report_values_and_status(world, get):
    data = call(get, world.users.admin, "inventory")
    t = data["totals"]
    assert t["stock_items"] == 5 and t["units_on_hand"] == 45
    assert money(t["stock_value"]) == D("198.00")  # 3 x 6.00 + 40 x 4.50
    assert t["items_without_cost"] == 3
    assert t["low_stock_items"] == 2 and t["out_of_stock_items"] == 2
    assert t["low_stock_products"] == 2 and t["out_of_stock_products"] == 2
    statuses = [r["status"] for r in data["results"]]
    assert statuses == sorted(statuses, key=["out", "low", "ok"].index)  # worst first by default
    mug = next(r for r in data["results"] if r["product_name"] == "Mug")
    assert mug["status"] == "ok" and money(mug["value"]) == D("180.00") and money(mug["unit_cost"]) == D("4.50")
    no_cost = next(r for r in data["results"] if r["product_name"] == "Tin" and r["branch_name"] == "Downtown")
    assert no_cost["value"] is None
    assert {r["product_name"] for r in data["low_stock"]} == {"Ethiopia Beans 250g", "Tin"}
    assert all(r["status"] in ("out", "low") for r in data["low_stock"]) and len(data["low_stock"]) == 4


def test_inventory_filters_and_ordering(world, get):
    out = call(get, world.users.admin, "inventory", status="out")
    assert out["count"] == 2 and all(r["status"] == "out" for r in out["results"])
    by_qty = call(get, world.users.admin, "inventory", ordering="-quantity")
    assert [r["quantity"] for r in by_qty["results"]] == [40, 3, 2, 0, 0]
    by_value = call(get, world.users.admin, "inventory", ordering="-value")
    assert by_value["results"][0]["product_name"] == "Mug" and by_value["results"][-1]["value"] is None  # NULLs last
    one = call(get, world.users.admin, "inventory", branch=world.b.pk)
    assert one["totals"]["stock_items"] == 2 and one["totals"]["units_on_hand"] == 2


def test_inventory_movements_summary_uses_branch_local_dates(world, get):
    data = call(get, world.users.admin, "inventory")
    by_type = {m["movement_type"]: m for m in data["movements"]}
    assert [m["movement_type"] for m in data["movements"]] == [
        "RECEIPT",
        "ADJUSTMENT",
        "SALE",
        "RETURN",
        "WASTE",
        "INITIAL",
    ]
    assert by_type["RECEIPT"]["units_in"] == 20 and by_type["RECEIPT"]["net_units"] == 20
    # 17 (Downtown) + 4 (Tokyo, 00:30 JST on Sep 1); the August 1 movement is outside
    assert by_type["SALE"]["units_out"] == 21 and by_type["SALE"]["movements"] == 2
    assert by_type["WASTE"]["units_out"] == 2 and by_type["ADJUSTMENT"]["movements"] == 0
    tokyo = call(get, world.users.admin, "inventory", branch=world.b.pk)
    assert {m["movement_type"]: m["units_out"] for m in tokyo["movements"]}["SALE"] == 4


# ── customers ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_customer_frequency_new_vs_returning_and_top_customers(world, get):
    data = call(get, world.users.admin, "customers")
    assert data["totals"]["customers"] == 5
    assert {r["bucket"]: r["customers"] for r in data["results"]} == {"1": 2, "2-3": 2, "4+": 1}
    assert abs(sum(r["share"] for r in data["results"]) - 100) < 0.2
    seg = {r["segment"]: r["customers"] for r in data["new_vs_returning"]}
    assert seg == {"new": 1, "returning": 4}  # only Carla has no counted order before September
    assert (data["totals"]["new_customers"], data["totals"]["returning_customers"]) == (1, 4)
    top = data["top_customers"]
    assert [t["name"] for t in top] == ["Alice A.", "Eve F.", "Bob B.", "Carla D.", "Dmitri E."]
    assert [money(t["spend"]) for t in top] == [D("72.55"), D("25.00"), D("22.40"), D("14.00"), D("10.50")]
    assert top[0]["orders"] == 4 and top[0]["email"] == "c***@example.com" and top[0]["phone"] == "***11"
    assert all("alice" not in str(t).lower() or t["name"] == "Alice A." for t in top)
    assert data["totals"]["orders_per_customer"] == round(11 / 5, 2)


def test_customer_new_returning_is_scoped_to_the_selected_branch(world, get):
    # History is judged within the selected scope: Carla has an earlier counted order in Tokyo, Alice does not.
    make_order(world.b, world.customers[2], utc(2026, 8, 10, 3), [COFFEE()])
    data = call(get, world.users.admin, "customers", branch=world.b.pk)
    seg = {r["segment"]: r["customers"] for r in data["new_vs_returning"]}
    assert data["totals"]["customers"] == 2
    assert seg == {"new": 1, "returning": 1}  # Alice new, Carla returning
