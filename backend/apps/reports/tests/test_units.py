"""Pure helpers and the definitions endpoint."""

import datetime as dt
from decimal import Decimal as D

import pytest

from apps.reports import selectors as sel
from apps.reports.context import ReportContext, bucket_starts
from apps.reports.definitions import DEFINITIONS

pytestmark = pytest.mark.django_db


def test_delta_pct_is_null_safe():
    assert sel.delta_pct(D("110"), D("100")) == 10.0
    assert sel.delta_pct(D("50"), D("100")) == -50.0
    assert sel.delta_pct(5, 0) is None and sel.delta_pct(0, 0) is None and sel.delta_pct(5, None) is None
    assert sel.delta_pct(D("154.25"), D("33.00")) == 367.4


def test_ratio_and_pct_round_half_up():
    assert sel.ratio(D("10.00"), 3) == D("3.33") and sel.ratio(D("10.00"), 0) == D("0.00")
    assert sel.ratio(D("0.05"), 2) == D("0.03")  # 0.025 -> half up
    assert sel.pct(1, 3) == 33.3 and sel.pct(1, 0) == 0.0


@pytest.mark.parametrize(
    "raw,masked",
    [("Jane Doe", "Jane D."), ("jane van der berg", "jane B."), ("Cher", "Cher"), ("", "Customer"), ("  ", "Customer")],
)
def test_mask_name(raw, masked):
    assert sel.mask_name(raw) == masked


def test_mask_contact_details():
    assert sel.mask_email("jane.doe@example.com") == "j***@example.com" and sel.mask_email("nonsense") == ""
    assert sel.mask_phone("+1 (555) 010-0199") == "***99" and sel.mask_phone("12") == ""


def ctx(gran, d_from, d_to):
    return ReportContext(
        user=None, branches=[], branch_ids=None, selected_branch=None, date_from=d_from, date_to=d_to, granularity=gran
    )


def test_bucket_starts_are_clipped_and_complete():
    c = ctx("week", dt.date(2026, 9, 3), dt.date(2026, 9, 20))  # Thu .. Sun
    assert bucket_starts(c) == [dt.date(2026, 9, 3), dt.date(2026, 9, 7), dt.date(2026, 9, 14)]
    c = ctx("month", dt.date(2026, 1, 31), dt.date(2026, 4, 2))
    assert bucket_starts(c) == [dt.date(2026, 1, 31), dt.date(2026, 2, 1), dt.date(2026, 3, 1), dt.date(2026, 4, 1)]
    assert len(bucket_starts(ctx("day", dt.date(2026, 2, 27), dt.date(2026, 3, 2)))) == 4


def test_signature_distinguishes_scopes():
    c = ctx("day", dt.date(2026, 9, 1), dt.date(2026, 9, 2))
    assert c.signature == "all"
    c.branch_ids = frozenset({3, 1})
    assert c.signature == "b:1,3"
    c.branch_ids = frozenset()
    assert c.signature == "b:"


def test_definitions_endpoint_lists_every_kpi(world, get):
    r = get(world.users.admin, "admin/reports/definitions/")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and all(set(d) == {"key", "label", "definition"} for d in data)
    keys = {d["key"] for d in data}
    kpis = get(world.users.admin, "admin/dashboard/").json()["kpis"]
    # every KPI shown on the dashboard has a definition (the UI renders them side by side)
    assert set(kpis) <= keys
    assert {"counting_rule", "period", "previous_period", "attention_refund_needed"} <= keys
    rule = next(d for d in data if d["key"] == "counting_rule")["definition"]
    assert "not CANCELLED" in rule and "cash order that is COMPLETED" in rule and "refund needed" in rule
    assert len(keys) == len(data) == len(DEFINITIONS)
