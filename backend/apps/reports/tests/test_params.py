"""Query-parameter validation: reversed / oversized / malformed ranges, branch and granularity."""

import datetime as dt

import pytest

pytestmark = pytest.mark.django_db

ENDPOINTS = ["admin/dashboard/", "admin/reports/sales/", "admin/reports/products/", "admin/reports/inventory/"]


def assert_400(r, field=None):
    assert r.status_code == 400, r.content
    err = r.json()["error"]
    assert err["code"] == "validation_error" and err["request_id"] is not None
    if field:
        assert field in err["fields"], err
    return err


@pytest.mark.parametrize("path", ENDPOINTS)
def test_reversed_range_is_rejected(world, get, path):
    assert_400(get(world.users.admin, path, date_from="2026-09-30", date_to="2026-09-01"), "date_to")


@pytest.mark.parametrize("path", ENDPOINTS)
def test_range_longer_than_400_days_is_rejected(world, get, path):
    assert_400(get(world.users.admin, path, date_from="2025-01-01", date_to="2026-02-05"), "date_to")  # 401 days


def test_exactly_400_days_is_allowed(world, get):
    r = get(
        world.users.admin, "admin/reports/sales/", date_from="2025-01-01", date_to="2026-02-04"
    )  # 400 days inclusive
    assert r.status_code == 200 and len(r.json()["results"]) == 400
    assert r.json()["period"]["date_from"] == "2025-01-01"


@pytest.mark.parametrize("value", ["2026-13-01", "2026-02-30", "yesterday", "01/09/2026", "20260901x"])
def test_malformed_dates_are_rejected(world, get, value):
    assert_400(get(world.users.admin, "admin/dashboard/", date_from=value, date_to="2026-09-30"), "date_from")
    assert_400(get(world.users.admin, "admin/reports/sales/", date_from="2026-09-01", date_to=value), "date_to")


@pytest.mark.parametrize("value", ["abc", "0", "-1", "1.5"])
def test_bad_branch_is_rejected(world, get, value):
    assert_400(get(world.users.admin, "admin/dashboard/", branch=value), "branch")


def test_bad_granularity_and_format_are_rejected(world, get):
    assert_400(get(world.users.admin, "admin/reports/sales/", granularity="hour"), "granularity")
    assert_400(get(world.users.admin, "admin/reports/sales/", format="xml"), "format")
    assert_400(get(world.users.admin, "admin/dashboard/", format="csv"), "format")  # dashboard has no export


def test_open_ended_ranges_default_sensibly(world, get):
    today = dt.date.today()
    only_to = get(world.users.admin, "admin/reports/sales/", date_to="2026-09-30").json()["period"]
    assert (only_to["date_from"], only_to["date_to"]) == ("2026-09-01", "2026-09-30")  # 30 days ending date_to
    only_from = get(world.users.admin, "admin/reports/sales/", date_from="2026-09-25").json()["period"]
    assert only_from["date_from"] == "2026-09-25" and only_from["date_to"] >= "2026-09-25"
    assert only_from["date_to"] in (
        today.isoformat(),
        (today + dt.timedelta(days=1)).isoformat(),
        (today - dt.timedelta(days=1)).isoformat(),
    )


def test_single_day_range(world, get):
    r = get(world.users.admin, "admin/reports/sales/", date_from="2026-09-01", date_to="2026-09-01").json()
    assert (
        len(r["results"]) == 1 and r["period"]["previous_date_from"] == "2026-08-31" == r["period"]["previous_date_to"]
    )
    assert r["totals"]["orders"] == 3  # Alice 10:00 UTC, Bob 23:59:59 UTC and Tokyo 00:30 JST


def test_previous_period_has_same_length(world, get):
    p = get(world.users.admin, "admin/reports/sales/", date_from="2026-09-11", date_to="2026-09-20").json()["period"]
    assert (p["previous_date_from"], p["previous_date_to"]) == ("2026-09-01", "2026-09-10")


def test_errors_use_the_standard_envelope(world, get):
    r = get(world.users.admin, "admin/dashboard/", date_from="nope")
    body = r.json()
    assert set(body) == {"error"} and {"code", "message", "fields", "request_id"} <= set(body["error"])
