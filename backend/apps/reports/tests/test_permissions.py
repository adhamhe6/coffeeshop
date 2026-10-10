"""Capability matrix and branch scoping for the dashboard and every report endpoint."""

import pytest

from .conftest import D_FROM, D_TO
from .helpers import make_order, utc

pytestmark = pytest.mark.django_db

PARAMS = {"date_from": D_FROM.isoformat(), "date_to": D_TO.isoformat()}
REPORTS = [
    "sales",
    "orders-by-status",
    "products",
    "categories",
    "branches",
    "promotions",
    "payments",
    "refunds",
    "inventory",
    "customers",
]

# role attribute on `world.users` -> (dashboard.view, reports.view, reports.export)
MATRIX = {
    "admin": (True, True, True),
    "super": (True, True, True),
    "manager_a": (True, True, True),
    "order_manager": (True, False, False),
    "support": (True, False, False),
    "marketing": (True, True, False),
    "inventory": (True, True, False),
    "product": (True, False, False),
}


@pytest.mark.parametrize("role", MATRIX)
def test_capability_matrix(world, get, role):
    dashboard_ok, reports_ok, export_ok = MATRIX[role]
    user = getattr(world.users, role)
    assert (get(user, "admin/dashboard/", **PARAMS).status_code == 200) is dashboard_ok
    for name in REPORTS:
        r = get(user, f"admin/reports/{name}/", **PARAMS)
        assert r.status_code == (200 if reports_ok else 403), (role, name)
        csv = get(user, f"admin/reports/{name}/", format="csv", **PARAMS)
        assert csv.status_code == (200 if export_ok else 403), (role, name, "csv")
        if csv.status_code == 200:
            list(csv.streaming_content)
        if not reports_ok:
            assert r.json()["error"]["code"] == "permission_denied"
    defs = get(user, "admin/reports/definitions/")
    assert defs.status_code == 200  # dashboard.view or reports.view


def test_anonymous_gets_401_and_customers_get_403(world, get):
    for path in ["admin/dashboard/", "admin/reports/sales/", "admin/reports/definitions/"]:
        r = get(None, path)
        assert r.status_code == 401 and r.json()["error"]["code"] == "not_authenticated"
        assert get(world.users.customer, path).status_code == 403


def test_export_forbidden_does_not_leak_data_or_start_stream(world, get):
    r = get(world.users.marketing, "admin/reports/sales/", format="csv", **PARAMS)
    assert r.status_code == 403 and r["Content-Type"].startswith("application/json")
    assert r.json()["error"]["code"] == "permission_denied"


# ── branch scoping ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_branch_manager_sees_only_own_branch_numbers(world, get):
    mine = get(world.users.manager_a, "admin/dashboard/", **PARAMS).json()
    exp = world.expected.kpis(D_FROM, D_TO, {world.a.pk})
    assert mine["kpis"]["gross_sales"]["value"] == f"{exp['gross_sales']:.2f}"
    assert mine["kpis"]["orders_total"]["value"] == exp["orders_total"]
    assert {r["branch_id"] for r in mine["branch_performance"]} == {world.a.pk}
    assert mine["period"]["timezones"] == ["UTC"]
    everything = get(world.users.admin, "admin/dashboard/", **PARAMS).json()
    assert everything["kpis"]["gross_sales"]["value"] != mine["kpis"]["gross_sales"]["value"]
    # recent orders only list the manager's branch
    assert {o["branch"] for o in mine["recent_orders"]} == {"Downtown"}


def test_branch_manager_cannot_select_another_branch(world, get):
    for path in ["admin/dashboard/", *(f"admin/reports/{n}/" for n in REPORTS)]:
        r = get(world.users.manager_a, path, branch=world.b.pk, **PARAMS)
        assert r.status_code == 404, path
        assert r.json()["error"]["code"] == "not_found"
        # their own branch is fine
        assert get(world.users.manager_a, path, branch=world.a.pk, **PARAMS).status_code == 200
    # same answer for a branch that does not exist: nothing about other branches is revealed
    assert get(world.users.manager_a, "admin/dashboard/", branch=999999, **PARAMS).status_code == 404
    assert get(world.users.admin, "admin/dashboard/", branch=999999, **PARAMS).status_code == 404


def test_multi_branch_manager_aggregates_exactly_their_branches(world, get):
    data = get(world.users.manager_ab, "admin/dashboard/", **PARAMS).json()
    exp = world.expected.kpis(D_FROM, D_TO, {world.a.pk, world.b.pk})
    assert data["kpis"]["net_sales"]["value"] == f"{exp['net_sales']:.2f}"
    assert {r["branch_id"] for r in data["branch_performance"]} == {world.a.pk, world.b.pk}
    assert sorted(data["period"]["timezones"]) == ["Asia/Tokyo", "UTC"]
    assert get(world.users.manager_ab, "admin/dashboard/", branch=world.c.pk, **PARAMS).status_code == 404


def test_scoped_reports_never_include_other_branches(world, get):
    user = world.users.manager_b
    sales = get(user, "admin/reports/sales/", **PARAMS).json()
    exp = world.expected.kpis(D_FROM, D_TO, {world.b.pk})
    assert sales["totals"]["gross_sales"] == f"{exp['gross_sales']:.2f}"
    assert [r["branch"] for r in get(user, "admin/reports/branches/", **PARAMS).json()["results"]] == ["Tokyo"]
    inv = get(user, "admin/reports/inventory/", **PARAMS).json()
    assert {r["branch_name"] for r in inv["results"]} == {"Tokyo"} and inv["totals"]["stock_items"] == 2
    refunds = get(user, "admin/reports/refunds/", **PARAMS).json()
    assert refunds["count"] == 0 and refunds["cancellations"] == []
    customers = get(user, "admin/reports/customers/", **PARAMS).json()
    assert customers["totals"]["customers"] == 2


def test_manager_without_branches_sees_nothing(world, get):
    for name in REPORTS:
        r = get(world.users.manager_none, f"admin/reports/{name}/", **PARAMS)
        assert r.status_code == 200, name
    assert get(world.users.manager_none, "admin/reports/sales/", **PARAMS).json()["totals"]["orders"] == 0
    assert get(world.users.manager_none, "admin/reports/inventory/", **PARAMS).json()["totals"]["stock_items"] == 0


def test_recent_customers_respect_capability_and_scope(world, get):
    tokyo = get(world.users.manager_b, "admin/dashboard/", **PARAMS).json()["recent_customers"]
    assert {c["name"] for c in tokyo} == {"Alice A.", "Carla D.", "Dmitri E."}  # only people who ordered in Tokyo
    assert (
        get(world.users.inventory, "admin/dashboard/", **PARAMS).json()["recent_customers"] == []
    )  # no customers.view
    assert get(world.users.marketing, "admin/dashboard/", **PARAMS).json()["recent_customers"] == []


def test_staff_accounts_are_never_listed_as_customers(world, get):
    names = {c["name"] for c in get(world.users.admin, "admin/dashboard/", **PARAMS).json()["recent_customers"]}
    assert all(n.startswith(("Alice", "Bob", "Carla", "Dmitri", "Eve")) for n in names)


def test_new_staff_order_in_other_branch_does_not_change_scoped_numbers(world, get):
    before = get(world.users.manager_a, "admin/dashboard/", **PARAMS).json()["kpis"]["gross_sales"]["value"]
    make_order(world.b, world.customers[0], utc(2026, 9, 15, 3))
    from django.core.cache import cache

    cache.clear()
    assert get(world.users.manager_a, "admin/dashboard/", **PARAMS).json()["kpis"]["gross_sales"]["value"] == before
