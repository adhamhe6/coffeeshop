from datetime import time
from decimal import Decimal

import pytest
from freezegun import freeze_time

from apps.branches.models import BranchClosure, BranchDeliveryZone, DeliveryZone
from apps.core.models import StoreSettings
from tests.factories import make_branch, make_zone

from .helpers import set_hours

pytestmark = pytest.mark.django_db

BRANCHES = "/api/v1/branches/"


@freeze_time("2026-06-15 12:00:00")  # Monday noon UTC
def test_branch_list_payload(api):
    branch = make_branch(
        slug="downtown",
        name="Downtown",
        phone="+1 555 0100",
        is_placeholder_address=True,
        image="branches/d.webp",
        latitude=Decimal("40.712800"),
        longitude=Decimal("-74.006000"),
        delivery=True,
    )
    make_zone("Old Town", branch, fee="2.50", min_order="12.00", free_over="30.00")
    make_branch(slug="hidden", is_active=False)
    r = api.get(BRANCHES)
    assert r.status_code == 200
    data = r.json()
    assert [b["slug"] for b in data] == ["downtown"]
    b = data[0]
    assert b["is_open_now"] is True and b["accepting_orders"] is True and b["pickup_enabled"] and b["delivery_enabled"]
    assert b["image"] == "/media/branches/d.webp" and b["is_placeholder_address"] is True
    assert (b["latitude"], b["longitude"], b["phone"], b["address_line"], b["city"]) == (
        "40.712800",
        "-74.006000",
        "+1 555 0100",
        "1 Test Street",
        "Testville",
    )
    assert b["delivery_zones"] == [
        {
            "zone_id": b["delivery_zones"][0]["zone_id"],
            "name": "Old Town",
            "slug": b["delivery_zones"][0]["slug"],
            "fee": "2.50",
            "min_order_total": "12.00",
            "free_delivery_over": "30.00",
            "eta_minutes": 30,
        }
    ]
    assert len(b["hours"]) == 7 and b["hours"][0] == {
        "weekday": 0,
        "label": "Monday",
        "text": "12:00 AM – 11:59 PM",
        "opens": "00:00:00",
        "closes": "23:59:00",
        "is_closed": False,
    }
    assert b["today_hours"]["text"] == "12:00 AM – 11:59 PM" and b["today_hours"]["is_closed"] is False
    assert b["next_open_at"] == "2026-06-15T12:00:00Z"


@freeze_time("2026-06-15 20:00:00")
def test_closed_branch_reports_next_open_and_today_text(api):
    branch = make_branch(slug="b", open_all_week=False)
    set_hours(branch, {0: (time(8), time(18)), 1: (time(9), time(17))})
    b = api.get(BRANCHES + "b/").json()
    assert b["is_open_now"] is False
    assert b["today_hours"]["text"] == "8:00 AM – 6:00 PM"
    assert b["next_open_at"] == "2026-06-16T09:00:00Z"
    assert [h["is_closed"] for h in b["hours"]] == [False, False, True, True, True, True, True]
    assert b["hours"][2]["text"] == "Closed" and b["hours"][2]["opens"] is None


@freeze_time("2026-06-15 12:00:00")
def test_closure_today_marks_closed(api):
    branch = make_branch(slug="b")
    BranchClosure.objects.create(branch=branch, start_date="2026-06-15", end_date="2026-06-16", reason="Holiday")
    b = api.get(BRANCHES + "b/").json()
    assert b["is_open_now"] is False and b["today_hours"]["text"] == "Closed today"
    assert b["next_open_at"].startswith("2026-06-17")


def test_delivery_zones_hidden_when_branch_has_no_delivery_or_link_inactive(api):
    pickup_only = make_branch(slug="p", delivery=False)
    make_zone("Z1", pickup_only)
    delivering = make_branch(slug="d", delivery=True)
    zone = make_zone("Z2", delivering)
    inactive_zone = make_zone("Z3", delivering)
    DeliveryZone.objects.filter(pk=inactive_zone.pk).update(is_active=False)
    BranchDeliveryZone.objects.filter(branch=delivering, zone=zone).update(is_active=True)
    data = {b["slug"]: b for b in api.get(BRANCHES).json()}
    assert data["p"]["delivery_zones"] == []
    assert [z["name"] for z in data["d"]["delivery_zones"]] == ["Z2"]


def test_branch_detail_404_for_inactive_or_unknown(api):
    make_branch(slug="off", is_active=False)
    assert api.get(BRANCHES + "off/").status_code == 404
    assert api.get(BRANCHES + "missing/").status_code == 404


def test_branch_query_count_is_constant(api, django_assert_max_num_queries):
    for i in range(6):
        branch = make_branch(slug=f"q{i}")
        make_zone(f"Zone q{i}", branch)
        BranchClosure.objects.create(branch=branch, start_date="2030-01-01", end_date="2030-01-02")
    with django_assert_max_num_queries(6):
        assert len(api.get(BRANCHES).json()) == 6


# ── slots endpoint ──────────────────────────────────────────────────────────────────────────────────────────────────


@freeze_time("2026-06-15 09:07:00")
def test_slots_endpoint_asap_and_slots(api):
    branch = make_branch(slug="b", prep_minutes=20, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(9), time(11))))
    r = api.get(BRANCHES + "b/slots/?type=PICKUP&date=2026-06-15")
    assert r.status_code == 200
    d = r.json()
    assert d["asap_available"] is True and d["asap_eta"] == "2026-06-15T09:27:00Z"
    assert d["unavailable_code"] is None and d["timezone"] == "UTC" and d["date"] == "2026-06-15"
    assert [s["starts_at"] for s in d["slots"]] == [
        "2026-06-15T09:30:00Z",
        "2026-06-15T09:45:00Z",
        "2026-06-15T10:00:00Z",
        "2026-06-15T10:15:00Z",
        "2026-06-15T10:30:00Z",
        "2026-06-15T10:45:00Z",
    ]
    assert d["slots"][0]["label"] == "9:30 AM"


@freeze_time("2026-06-15 12:00:00")
def test_slots_default_type_and_date_and_other_day(api):
    make_branch(slug="b", prep_minutes=0)
    today = api.get(BRANCHES + "b/slots/").json()
    assert today["date"] == "2026-06-15" and today["slots"][0]["starts_at"] == "2026-06-15T12:00:00Z"
    tomorrow = api.get(BRANCHES + "b/slots/?date=2026-06-16").json()
    assert tomorrow["slots"][0]["starts_at"] == "2026-06-16T00:00:00Z" and tomorrow["asap_available"] is True


@freeze_time("2026-06-15 12:00:00")
def test_slots_out_of_range_dates_are_empty_not_errors(api):
    make_branch(slug="b")
    assert api.get(BRANCHES + "b/slots/?date=2026-06-14").json()["slots"] == []
    assert api.get(BRANCHES + "b/slots/?date=2026-06-23").json()["slots"] == []
    assert api.get(BRANCHES + "b/slots/?date=2026-06-22").json()["slots"] != []


@freeze_time("2026-06-15 12:00:00")
def test_slots_validation(api):
    make_branch(slug="b")
    assert api.get(BRANCHES + "b/slots/?type=TELEPORT").status_code == 400
    r = api.get(BRANCHES + "b/slots/?date=15-06-2026")
    assert r.status_code == 400 and "date" in r.json()["error"]["fields"]
    assert api.get(BRANCHES + "nope/slots/").status_code == 404
    make_branch(slug="off", is_active=False)
    assert api.get(BRANCHES + "off/slots/").status_code == 404


@freeze_time("2026-06-15 12:00:00")
def test_slots_when_closed_now_still_lists_later_slots_but_no_asap(api):
    branch = make_branch(slug="b", open_all_week=False, prep_minutes=10)
    set_hours(branch, dict.fromkeys(range(7), (time(14), time(15))))
    d = api.get(BRANCHES + "b/slots/").json()
    assert d["asap_available"] is False and d["asap_eta"] is None and d["unavailable_code"] == "branch_closed"
    assert [s["label"] for s in d["slots"]] == ["2:00 PM", "2:15 PM", "2:30 PM", "2:45 PM"]


@freeze_time("2026-06-15 12:00:00")
def test_slots_blocked_when_paused_disabled_or_ordering_off(api):
    make_branch(slug="paused", accepting_orders=False)
    make_branch(slug="nodelivery", delivery=False)
    make_branch(slug="ok")
    d = api.get(BRANCHES + "paused/slots/").json()
    assert d["slots"] == [] and d["asap_available"] is False and d["unavailable_code"] == "branch_closed"
    d = api.get(BRANCHES + "nodelivery/slots/?type=DELIVERY").json()
    assert d["slots"] == [] and d["unavailable_code"] == "delivery_unavailable"
    StoreSettings.load()
    StoreSettings.objects.filter(pk=1).update(ordering_enabled=False)
    d = api.get(BRANCHES + "ok/slots/").json()
    assert d["slots"] == [] and d["unavailable_code"] == "ordering_paused"


@freeze_time("2026-06-15 12:00:00")
def test_slots_honor_timezone_and_closure(api):
    branch = make_branch(slug="ny", timezone="America/New_York", open_all_week=False, prep_minutes=0)
    set_hours(branch, dict.fromkeys(range(7), (time(9), time(10))))
    d = api.get(BRANCHES + "ny/slots/?date=2026-06-16").json()
    assert d["slots"][0]["starts_at"] == "2026-06-16T13:00:00Z" and d["slots"][0]["label"] == "9:00 AM"
    BranchClosure.objects.create(branch=branch, start_date="2026-06-16", end_date="2026-06-16")
    assert api.get(BRANCHES + "ny/slots/?date=2026-06-16").json()["slots"] == []


# ── delivery zones ──────────────────────────────────────────────────────────────────────────────────────────────────


def test_public_delivery_zones(api):
    branch = make_branch(slug="d")
    zone = make_zone("Old Town", branch)
    off = make_zone("Offline")
    off.is_active = False
    off.save()
    make_zone("Unserved")
    r = api.get("/api/v1/delivery-zones/")
    assert r.status_code == 200
    by_name = {z["name"]: z for z in r.json()}
    assert set(by_name) == {"Old Town", "Unserved"}
    assert by_name["Old Town"]["branch_slugs"] == ["d"] and by_name["Unserved"]["branch_slugs"] == []
    assert by_name["Old Town"]["id"] == zone.id
