"""Dashboard figures reconciled against an independent Python recomputation of the same dataset."""

import datetime as dt
from collections import defaultdict
from decimal import Decimal as D

import pytest

from .conftest import D_FROM, D_TO, P_FROM, P_TO
from .helpers import COFFEE, ZERO, make_order

pytestmark = pytest.mark.django_db

MONEY = (
    "gross_sales",
    "discounts",
    "delivery_fees",
    "tax",
    "refunds",
    "net_sales",
    "revenue_collected",
    "average_order_value",
)
COUNTS = ("orders_total", "orders_counted", "orders_completed", "orders_pending", "orders_cancelled")
PARAMS = {"date_from": D_FROM.isoformat(), "date_to": D_TO.isoformat()}


def dashboard(get, user, **extra):
    r = get(user, "admin/dashboard/", **{**PARAMS, **extra})
    assert r.status_code == 200, r.content
    return r.json()


def num(value):
    return D(value) if isinstance(value, str) else value


def test_kpis_match_independent_computation_all_branches(world, get):
    data = dashboard(get, world.users.admin)
    exp = world.expected.kpis(D_FROM, D_TO)
    for key in (*MONEY, *COUNTS):
        assert num(data["kpis"][key]["value"]) == exp[key], key
    # hand-checked headline numbers, so the oracle itself cannot silently drift
    assert exp["orders_total"] == 15 and exp["orders_counted"] == 11
    assert exp["gross_sales"] == D("154.25")
    assert exp["discounts"] == D("3.10")
    assert exp["refunds"] == D("16.00")
    assert exp["net_sales"] == D("135.15")
    assert exp["delivery_fees"] == D("5.00")
    assert exp["average_order_value"] == D("12.29")  # 135.15 / 11 = 12.2863..
    assert data["kpis"]["net_sales"]["value"] == "135.15"


def test_kpis_for_single_branches_use_exact_local_windows(world, get):
    for branch in (world.a, world.b, world.c):
        data = dashboard(get, world.users.admin, branch=branch.pk)
        exp = world.expected.kpis(D_FROM, D_TO, {branch.pk})
        for key in (*MONEY, *COUNTS):
            assert num(data["kpis"][key]["value"]) == exp[key], (branch.code, key)
        assert data["period"]["branch"] == branch.pk
        assert data["period"]["timezones"] == [branch.timezone]


def test_timezone_bucket_boundaries(world, get):
    """Tokyo 00:30 JST on Sep 1 is Aug 31 in UTC; New York 23:30 EDT on Sep 30 is Oct 1 in UTC."""
    tokyo = dashboard(get, world.users.admin, branch=world.b.pk)
    by_day = {p["bucket"]: p for p in tokyo["series"]}
    assert by_day["2026-09-01"]["orders"] == 1 and D(by_day["2026-09-01"]["gross_sales"]) == D("28.00")
    assert by_day["2026-09-30"]["orders"] == 1 and D(by_day["2026-09-30"]["gross_sales"]) == D("14.00")  # 23:59:59 JST
    assert tokyo["kpis"]["orders_total"]["value"] == 2  # the 00:00 JST Oct 1 order is out of range
    assert tokyo["kpis"]["orders_total"]["previous"] == 1  # 23:59 JST Aug 31 belongs to the previous period

    ny = dashboard(get, world.users.admin, branch=world.c.pk)
    by_day = {p["bucket"]: p for p in ny["series"]}
    assert ny["kpis"]["orders_total"]["value"] == 2
    assert ny["kpis"]["orders_total"]["previous"] == 1  # 23:30 EDT Aug 31 (= Sep 1 03:30 UTC)
    assert by_day["2026-09-30"]["orders"] == 1  # PREPARING + PAID order placed Oct 1 03:30 UTC
    assert by_day["2026-09-01"]["orders"] == 0


def test_all_branch_view_buckets_each_order_in_its_own_branch_timezone(world, get):
    data = dashboard(get, world.users.admin)
    assert sorted(data["period"]["timezones"]) == ["America/New_York", "Asia/Tokyo", "UTC"]
    by_day = {p["bucket"]: p for p in data["series"]}
    # Sep 1: Alice (UTC 10:00), Bob (UTC 23:59:59) and Tokyo's 00:30 JST order; NY 23:30 Aug 31 is excluded
    assert by_day["2026-09-01"]["orders"] == 3
    assert by_day["2026-09-30"]["orders"] == 2  # Tokyo 23:59:59 JST + NY 23:30 EDT


def test_previous_period_and_deltas(world, get):
    data = dashboard(get, world.users.admin)
    prev = world.expected.kpis(P_FROM, P_TO)
    assert data["period"]["previous_date_from"] == "2026-08-02" and data["period"]["previous_date_to"] == "2026-08-31"
    assert prev["gross_sales"] == D("33.00") and prev["orders_total"] == 5
    for key in (*MONEY, *COUNTS):
        assert num(data["kpis"][key]["previous"]) == prev[key], key
    gross = data["kpis"]["gross_sales"]
    assert gross["delta_pct"] == round(float((D("154.25") - D("33.00")) * 100 / D("33.00")), 1) == 367.4
    # previous == 0 -> null (no division by zero)
    assert data["kpis"]["delivery_fees"]["previous"] == "0.00" and data["kpis"]["delivery_fees"]["delta_pct"] is None
    # snapshot KPIs have no previous value
    for key in ("active_products", "low_stock_products", "out_of_stock_products"):
        assert data["kpis"][key]["previous"] is None and data["kpis"][key]["delta_pct"] is None


def test_series_is_zero_filled_and_reconciles(world, get):
    data = dashboard(get, world.users.admin)
    series = data["series"]
    assert [p["bucket"] for p in series] == [(D_FROM + dt.timedelta(days=i)).isoformat() for i in range(30)]
    exp = defaultdict(lambda: {"orders": 0, "gross": ZERO, "net": ZERO, "collected": ZERO})
    for s in world.expected.window(D_FROM, D_TO):
        if s.counted:
            e = exp[s.local_date]
            e["orders"] += 1
            e["gross"] += s.subtotal
            e["net"] += s.subtotal - s.discount - s.refunded
            e["collected"] += s.total - s.refunded
    for p in series:
        e = exp[dt.date.fromisoformat(p["bucket"])]
        assert (p["orders"], D(p["gross_sales"]), D(p["net_sales"]), D(p["revenue_collected"])) == (
            e["orders"],
            e["gross"],
            e["net"],
            e["collected"],
        ), p["bucket"]
    assert sum(p["orders"] for p in series) == data["kpis"]["orders_counted"]["value"]
    assert sum(D(p["net_sales"]) for p in series) == D(data["kpis"]["net_sales"]["value"])
    empty = [p for p in series if p["orders"] == 0]
    assert empty and all(D(p["gross_sales"]) == 0 and D(p["average_order_value"]) == 0 for p in empty)


@pytest.mark.parametrize(
    "granularity,expected_buckets",
    [("week", ["2026-09-01", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]), ("month", ["2026-09-01"])],
)
def test_week_and_month_buckets_are_clipped_to_the_range(world, get, granularity, expected_buckets):
    data = dashboard(get, world.users.admin, granularity=granularity)
    assert [p["bucket"] for p in data["series"]] == expected_buckets
    assert sum(p["orders"] for p in data["series"]) == 11
    assert sum(D(p["net_sales"]) for p in data["series"]) == D("135.15")


def test_status_counts_and_exclusions(world, get):
    data = dashboard(get, world.users.admin)
    expected = world.expected.by_status(D_FROM, D_TO)
    got = {row["status"]: row["count"] for row in data["orders_by_status"]}
    assert {k: v for k, v in got.items() if v} == expected
    assert sum(got.values()) == data["kpis"]["orders_total"]["value"] == 15
    assert abs(sum(r["share"] for r in data["orders_by_status"]) - 100) < 0.2
    # unpaid (PENDING/PENDING), cancelled-but-paid, FAILED payment and cash-not-completed orders are not sales
    assert data["kpis"]["orders_total"]["value"] - data["kpis"]["orders_counted"]["value"] == 4
    # CONFIRMED (Bob), PREPARING (delivery), PENDING (unpaid), PENDING (failed), CONFIRMED (cash), PREPARING (New York)
    assert data["kpis"]["orders_pending"]["value"] == 6
    assert data["kpis"]["orders_pending"]["value"] == world.expected.kpis(D_FROM, D_TO)["orders_pending"]


def test_cancelled_paid_order_is_not_sales_but_needs_refund(world, get):
    data = dashboard(get, world.users.admin)
    assert data["attention"]["refund_needed"] == 1
    # the cancelled-but-paid Beans x2 (28.00) must not appear in gross: oracle gross is 154.25
    assert data["kpis"]["gross_sales"]["value"] == "154.25"


def test_refunds_are_netted_from_net_sales_and_revenue(world, get):
    data = dashboard(get, world.users.admin)
    k = data["kpis"]
    assert D(k["refunds"]["value"]) == D("16.00")
    assert D(k["net_sales"]["value"]) == D(k["gross_sales"]["value"]) - D(k["discounts"]["value"]) - D(
        k["refunds"]["value"]
    )
    # revenue = totals - refunds: gross - discounts + delivery + tax - refunds
    assert D(k["revenue_collected"]["value"]) == D("154.25") - D("3.10") + D("5.00") + D(k["tax"]["value"]) - D("16.00")


def test_cash_orders_count_only_when_completed(world, get):
    # Both A6 (cash, COMPLETED, payment PENDING) counted; A10 (cash, CONFIRMED) not.
    data = dashboard(get, world.users.admin, branch=world.a.pk)
    spec_counted = [s for s in world.expected.window(D_FROM, D_TO, {world.a.pk}) if s.counted]
    assert data["kpis"]["orders_counted"]["value"] == len(spec_counted) == 7
    assert any(s.payment_method == "cash" and s.payment_status == "PENDING" for s in spec_counted)


def test_payment_failures_attention_and_stock_kpis(world, get):
    data = dashboard(get, world.users.admin)
    assert data["kpis"]["payment_failures"]["value"] == 2  # the failed order has two FAILED attempts
    assert data["kpis"]["payment_failures"]["previous"] == 0
    assert data["attention"] == {"stuck_orders": 0, "failed_payments": 1, "refund_needed": 1, "low_stock": 2}
    assert data["kpis"]["low_stock_products"]["value"] == 2
    assert data["kpis"]["out_of_stock_products"]["value"] == 2


def test_stuck_orders_attention(world, get):
    old = dt.datetime.now(dt.UTC) - dt.timedelta(hours=3)
    cust = world.customers[0]
    stuck = make_order(world.a, cust, old, [COFFEE()], status="CONFIRMED", updated_at=old)
    make_order(
        world.a, cust, old, [COFFEE()], status="PENDING", payment_status="PENDING", updated_at=old
    )  # online, awaiting payment: fine
    make_order(
        world.a,
        cust,
        old,
        [COFFEE()],
        status="CONFIRMED",
        updated_at=old,
        requested_for=dt.datetime.now(dt.UTC) + dt.timedelta(days=1),
    )  # scheduled
    make_order(world.a, cust, old, [COFFEE()], status="COMPLETED", updated_at=old)  # terminal
    make_order(
        world.a,
        cust,
        old,
        [COFFEE()],
        status="PENDING",
        payment_status="PENDING",
        payment_method="cash",
        payment=False,
        updated_at=old,
    )  # cash, never accepted
    data = dashboard(get, world.users.admin, branch=world.a.pk)
    assert data["attention"]["stuck_orders"] == 2
    assert stuck.order.number  # created


def test_category_sales_and_top_products_use_item_snapshots(world, get):
    data = dashboard(get, world.users.admin)
    cat = defaultdict(lambda: {"units": 0, "net": ZERO})
    prod = defaultdict(lambda: {"units": 0, "net": ZERO, "name": ""})
    for s in world.expected.window(D_FROM, D_TO):
        if not s.counted:
            continue
        for ln in s.lines:
            cat[ln.category]["units"] += ln.qty
            cat[ln.category]["net"] += ln.total - ln.discount
            prod[ln.sku]["units"] += ln.qty
            prod[ln.sku]["net"] += ln.total - ln.discount
            prod[ln.sku]["name"] = ln.name
    got = {r["category"]: r for r in data["category_sales"]}
    assert set(got) == set(cat)
    for name, e in cat.items():
        assert got[name]["units"] == e["units"] and D(got[name]["net"]) == e["net"], name
    assert abs(sum(r["share"] for r in data["category_sales"]) - 100) < 0.3
    by_units = data["top_products"]["by_units"]
    assert [r["sku"] for r in by_units] == [
        k for k, _ in sorted(prod.items(), key=lambda kv: (-kv[1]["units"], -kv[1]["net"], kv[0]))
    ]
    by_rev = data["top_products"]["by_revenue"]
    assert [r["sku"] for r in by_rev] == [
        k for k, _ in sorted(prod.items(), key=lambda kv: (-kv[1]["net"], -kv[1]["units"], kv[0]))
    ]
    for r in by_rev:
        assert D(r["revenue"]) == prod[r["sku"]]["net"] and r["units"] == prod[r["sku"]]["units"]
        assert r["product_name"] == prod[r["sku"]]["name"]


def test_branch_performance_lists_every_branch_in_scope(world, get):
    data = dashboard(get, world.users.admin)
    rows = {r["branch_id"]: r for r in data["branch_performance"]}
    assert set(rows) == {world.a.pk, world.b.pk, world.c.pk}
    for branch in (world.a, world.b, world.c):
        exp = world.expected.kpis(D_FROM, D_TO, {branch.pk})
        r = rows[branch.pk]
        assert r["orders"] == exp["orders_counted"]
        assert (D(r["gross_sales"]), D(r["net_sales"]), D(r["average_order_value"])) == (
            exp["gross_sales"],
            exp["net_sales"],
            exp["average_order_value"],
        )
    assert sum(D(r["net_sales"]) for r in rows.values()) == D(data["kpis"]["net_sales"]["value"])


def test_recent_orders_and_customers_are_masked(world, get):
    data = dashboard(get, world.users.admin)
    assert len(data["recent_orders"]) == 8
    first = data["recent_orders"][0]
    assert first["customer"] == "Eve F." and first["status"] == "PREPARING" and first["payment_status"] == "PAID"
    assert set(first) == {"number", "customer", "branch", "total", "status", "payment_status", "placed_at"}
    assert all("@" not in str(v) for r in data["recent_orders"] for v in r.values())
    assert [c["name"] for c in data["recent_customers"]] == ["Eve F.", "Dmitri E.", "Carla D.", "Bob B.", "Alice A."]
    assert all(set(c) == {"name", "joined_at"} for c in data["recent_customers"])


def test_demo_flag_follows_counted_orders_in_range(world, get):
    assert dashboard(get, world.users.admin)["is_demo_data"] is True  # the 09-20 order is is_demo and counted
    assert dashboard(get, world.users.admin, date_to="2026-09-10")["is_demo_data"] is False


def test_empty_scope_returns_zeros(world, get):
    data = dashboard(get, world.users.manager_none)
    assert data["kpis"]["gross_sales"]["value"] == "0.00" and data["kpis"]["orders_total"]["value"] == 0
    assert data["branch_performance"] == [] and data["recent_orders"] == []
    assert data["recent_customers"] == []
    assert len(data["series"]) == 30


def test_period_without_orders(world, get):
    data = dashboard(get, world.users.admin, date_from="2025-01-01", date_to="2025-01-31")
    assert data["kpis"]["orders_total"]["value"] == 0
    assert data["kpis"]["average_order_value"]["value"] == "0.00"
    assert data["kpis"]["gross_sales"]["delta_pct"] is None
    assert data["is_demo_data"] is False


def test_default_range_is_last_30_days_ending_today(world, get):
    r = get(world.users.admin, "admin/dashboard/")
    assert r.status_code == 200
    p = r.json()["period"]
    assert (dt.date.fromisoformat(p["date_to"]) - dt.date.fromisoformat(p["date_from"])).days == 29
    assert len(r.json()["series"]) == 30
