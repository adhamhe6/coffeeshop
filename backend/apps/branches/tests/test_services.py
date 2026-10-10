from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import pytest
from freezegun import freeze_time

from apps.branches import services
from apps.branches.models import BranchClosure, BranchDeliveryZone
from apps.core.errors import DomainError
from apps.core.models import StoreSettings
from tests.factories import make_branch, make_zone

from .helpers import set_hours

pytestmark = pytest.mark.django_db

MON = date(2026, 6, 15)  # a Monday


def utc(day, hh, mm=0):
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=UTC)


def code_of(call):
    with pytest.raises(DomainError) as exc:
        call()
    return exc.value.detail.code


# ── slots ───────────────────────────────────────────────────────────────────────────────────────────────────────────


@freeze_time("2026-06-15 08:00:00")
def test_slots_are_quarter_hours_inside_opening_hours_after_prep():
    branch = make_branch(prep_minutes=10, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(9), time(11))))
    slots = services.available_slots(branch, "PICKUP", MON)
    # now 08:00 + 10 min -> 08:15 earliest but branch opens 09:00; last slot starts before 11:00
    assert slots[0] == utc(MON, 9, 0)
    assert slots[-1] == utc(MON, 10, 45)
    assert len(slots) == 8
    assert all(s.minute % 15 == 0 and s.tzinfo is not None for s in slots)


@freeze_time("2026-06-15 09:07:00")
def test_prep_time_pushes_first_slot_and_rounds_up():
    branch = make_branch(prep_minutes=20, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(9), time(12))))
    slots = services.available_slots(branch, "PICKUP", MON)
    # 09:07 + 20 = 09:27 -> rounded up to 09:30
    assert slots[0] == utc(MON, 9, 30)


@freeze_time("2026-06-15 09:00:00")
def test_prep_exactly_on_boundary_is_kept():
    branch = make_branch(prep_minutes=15, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(8), time(12))))
    assert services.available_slots(branch, "PICKUP", MON)[0] == utc(MON, 9, 15)


@freeze_time("2026-06-15 13:00:00")
def test_past_slots_excluded_and_day_over_gives_empty():
    branch = make_branch(prep_minutes=0, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(9), time(12))))
    assert services.available_slots(branch, "PICKUP", MON) == []
    assert services.available_slots(branch, "PICKUP", date(2026, 6, 14)) == []  # yesterday


@freeze_time("2026-06-15 08:00:00")
def test_closed_weekday_and_closure_period_yield_no_slots():
    branch = make_branch(open_all_week=False)
    set_hours(branch, {0: (time(9), time(17)), 1: None, 2: (time(9), time(17))})
    tuesday, wednesday = date(2026, 6, 16), date(2026, 6, 17)
    assert services.available_slots(branch, "PICKUP", tuesday) == []
    assert services.available_slots(branch, "PICKUP", wednesday)
    BranchClosure.objects.create(branch=branch, start_date=wednesday, end_date=wednesday, reason="Holiday")
    branch = type(branch).objects.get(pk=branch.pk)
    assert services.available_slots(branch, "PICKUP", wednesday) == []
    assert services.available_slots(branch, "PICKUP", MON)


@freeze_time("2026-06-15 12:00:00")
def test_slots_respect_branch_timezone():
    # New York is UTC-4 in June: 09:00 local = 13:00 UTC
    branch = make_branch(timezone="America/New_York", prep_minutes=0, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(9), time(10))))
    slots = services.available_slots(branch, "PICKUP", MON)
    assert slots == [utc(MON, 13, 0), utc(MON, 13, 15), utc(MON, 13, 30), utc(MON, 13, 45)]
    assert services.format_slot_label(slots[0], branch) == "9:00 AM"


@freeze_time("2026-06-15 03:00:00")
def test_timezone_ahead_of_utc_uses_local_calendar_day():
    # Tokyo (UTC+9): local 12:00 Monday = 03:00 UTC Monday
    branch = make_branch(timezone="Asia/Tokyo", prep_minutes=0, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(12), time(13))))
    slots = services.available_slots(branch, "PICKUP", MON)
    assert slots[0] == utc(MON, 3, 0)
    assert services.is_open_now(branch)


@freeze_time("2026-06-15 08:00:00")
def test_slots_limited_to_seven_days_ahead():
    branch = make_branch(prep_minutes=0)
    assert services.available_slots(branch, "PICKUP", MON + timedelta(days=7))  # inside horizon until 08:00
    assert max(services.available_slots(branch, "PICKUP", MON + timedelta(days=7))) <= utc(MON, 8) + timedelta(days=7)
    assert services.available_slots(branch, "PICKUP", MON + timedelta(days=8)) == []


@freeze_time("2026-06-15 08:00:00")
def test_slots_empty_for_disabled_type_and_inactive_branch():
    branch = make_branch(pickup=True, delivery=False)
    assert services.available_slots(branch, "PICKUP", MON)
    assert services.available_slots(branch, "DELIVERY", MON) == []
    assert services.available_slots(branch, "TELEPORT", MON) == []
    branch.is_active = False
    assert services.available_slots(branch, "PICKUP", MON) == []


@freeze_time("2026-03-29 12:00:00")
def test_dst_spring_forward_day_has_no_phantom_slots():
    # Europe/Berlin jumps 02:00 -> 03:00 on 2026-03-29; hours 01:00-04:00 hold only 2 real hours.
    branch = make_branch(timezone="Europe/Berlin", prep_minutes=0, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(1), time(4))))
    slots = services.available_slots(branch, "PICKUP", date(2026, 3, 30))  # next day: normal
    assert len(slots) == 12
    with freeze_time("2026-03-28 12:00:00"):
        day = services.available_slots(branch, "PICKUP", date(2026, 3, 29))
    assert len(day) == len(set(day)) == 8  # 01:00-02:00 + 03:00-04:00 local


@freeze_time("2026-06-15 09:00:00")
def test_asap_eta_only_when_open():
    branch = make_branch(prep_minutes=12, open_all_week=False)
    set_hours(branch, dict.fromkeys(range(7), (time(8), time(18))))
    assert services.asap_eta(branch) == utc(MON, 9, 12)
    with freeze_time("2026-06-15 19:00:00"):
        assert services.asap_eta(branch) is None


@freeze_time("2026-06-15 19:00:00")
def test_next_open_at_and_hours_text():
    branch = make_branch(open_all_week=False)
    set_hours(branch, {0: (time(8), time(18)), 1: (time(8, 30), time(18)), 2: None})
    assert services.next_open_at(branch) == utc(date(2026, 6, 16), 8, 30)
    with freeze_time("2026-06-15 10:00:00"):
        assert services.next_open_at(branch) == utc(MON, 10, 0)  # open now
    assert services.format_hours(branch.hours.get(weekday=0)) == "8:00 AM – 6:00 PM"
    assert services.format_hours(branch.hours.get(weekday=2)) == "Closed"
    assert services.format_hours(None) == "Closed"


# ── assert_branch_accepts ───────────────────────────────────────────────────────────────────────────────────────────


@freeze_time("2026-06-15 12:00:00")
def test_accepts_asap_pickup_and_delivery_when_open():
    branch = make_branch()
    assert services.assert_branch_accepts(branch, "PICKUP") is None
    assert services.assert_branch_accepts(branch, "DELIVERY") is None


@freeze_time("2026-06-15 12:00:00")
def test_ordering_paused_globally():
    branch = make_branch()
    StoreSettings.load()
    StoreSettings.objects.filter(pk=1).update(ordering_enabled=False)
    with pytest.raises(DomainError) as exc:
        services.assert_branch_accepts(branch, "PICKUP")
    assert exc.value.detail.code == "ordering_paused" and exc.value.status_code == 409


@freeze_time("2026-06-15 12:00:00")
def test_branch_inactive_paused_and_closed_now_use_branch_closed():
    inactive = make_branch(is_active=False)
    paused = make_branch(accepting_orders=False)
    closed = make_branch(open_all_week=False)
    for branch, reason in ((inactive, "inactive"), (paused, "paused"), (closed, "closed_now")):
        with pytest.raises(DomainError) as exc:
            services.assert_branch_accepts(branch, "PICKUP")
        assert exc.value.detail.code == "branch_closed"
        assert exc.value.extra["reason"] == reason


@freeze_time("2026-06-15 12:00:00")
def test_pickup_and_delivery_disabled_codes():
    no_pickup = make_branch(pickup=False, delivery=True)
    no_delivery = make_branch(pickup=True, delivery=False)
    assert code_of(lambda: services.assert_branch_accepts(no_pickup, "PICKUP")) == "pickup_unavailable"
    assert code_of(lambda: services.assert_branch_accepts(no_delivery, "DELIVERY")) == "delivery_unavailable"
    assert services.assert_branch_accepts(no_pickup, "DELIVERY") is None


@freeze_time("2026-06-15 12:00:00")
def test_unknown_order_type_rejected():
    assert code_of(lambda: services.assert_branch_accepts(make_branch(), "DRONE")) == "invalid_order_type"


@freeze_time("2026-06-15 12:00:00")
def test_requested_slot_must_be_a_real_slot():
    branch = make_branch(prep_minutes=10)
    ok = utc(MON, 13, 0)
    assert services.assert_branch_accepts(branch, "PICKUP", ok) is None
    for bad in (
        utc(MON, 13, 7),  # not on the quarter hour
        utc(MON, 12, 0),  # now: less than prep time ahead
        utc(MON, 11, 0),  # past
        utc(MON, 12, 0) + timedelta(days=9),  # beyond 7 days
        datetime(2026, 6, 15, 13, 0),  # naive
        datetime(2026, 6, 15, 13, 0, 30, tzinfo=UTC),  # seconds
    ):
        with pytest.raises(DomainError) as exc:
            services.assert_branch_accepts(branch, "PICKUP", bad)
        assert exc.value.detail.code == "slot_invalid", bad
        assert "requested_for" in exc.value.fields
        assert exc.value.status_code == 400


@freeze_time("2026-06-15 12:00:00")
def test_scheduled_order_allowed_while_closed_now_but_not_in_closure_or_after_hours():
    branch = make_branch(open_all_week=False, prep_minutes=10)
    set_hours(branch, dict.fromkeys(range(7), (time(14), time(18))))  # closed right now (12:00)
    assert code_of(lambda: services.assert_branch_accepts(branch, "PICKUP")) == "branch_closed"
    assert services.assert_branch_accepts(branch, "PICKUP", utc(MON, 14, 30)) is None
    assert code_of(lambda: services.assert_branch_accepts(branch, "PICKUP", utc(MON, 18, 0))) == "slot_invalid"
    assert code_of(lambda: services.assert_branch_accepts(branch, "PICKUP", utc(MON, 13, 45))) == "slot_invalid"
    BranchClosure.objects.create(branch=branch, start_date=MON, end_date=MON)
    branch = type(branch).objects.get(pk=branch.pk)
    assert code_of(lambda: services.assert_branch_accepts(branch, "PICKUP", utc(MON, 14, 30))) == "slot_invalid"


@freeze_time("2026-06-15 12:00:00")
def test_closure_blocks_asap_too():
    branch = make_branch()
    BranchClosure.objects.create(branch=branch, start_date=MON, end_date=MON)
    branch = type(branch).objects.get(pk=branch.pk)
    assert code_of(lambda: services.assert_branch_accepts(branch, "PICKUP")) == "branch_closed"


# ── delivery_terms ──────────────────────────────────────────────────────────────────────────────────────────────────


def test_delivery_terms_fee_minimum_and_free_over():
    branch = make_branch()
    zone = make_zone(branch=branch, fee="3.50", min_order="10.00", free_over="25.00")
    terms = services.delivery_terms(branch, zone, Decimal("12.00"))
    assert terms == services.DeliveryTerms(Decimal("3.50"), Decimal("10.00"), 30)
    assert services.delivery_terms(branch, zone, "25.00").fee == Decimal("0.00")
    assert services.delivery_terms(branch, zone, "24.99").fee == Decimal("3.50")


def test_delivery_terms_below_minimum():
    branch = make_branch()
    zone = make_zone(branch=branch, min_order="15.00")
    with pytest.raises(DomainError) as exc:
        services.delivery_terms(branch, zone, "14.99")
    assert exc.value.detail.code == "below_delivery_minimum"
    assert exc.value.extra["min_order_total"] == "15.00"


def test_delivery_terms_zone_not_served_cases():
    branch, other = make_branch(), make_branch()
    unlinked = make_zone()
    linked_elsewhere = make_zone(branch=other)
    inactive_link = make_zone(branch=branch)
    BranchDeliveryZone.objects.filter(branch=branch, zone=inactive_link).update(is_active=False)
    inactive_zone = make_zone(branch=branch)
    inactive_zone.is_active = False
    inactive_zone.save()
    for zone in (None, unlinked, linked_elsewhere, inactive_link, inactive_zone):
        assert code_of(lambda zone=zone: services.delivery_terms(branch, zone, "50.00")) == "zone_not_served"


def test_delivery_terms_requires_delivery_enabled():
    branch = make_branch(delivery=False)
    zone = make_zone(branch=branch)
    assert code_of(lambda: services.delivery_terms(branch, zone, "50.00")) == "zone_not_served"
