# ruff: noqa: C408
"""Branches, opening hours, delivery zones. All addresses are PLACEHOLDERS (is_placeholder_address=True)."""

from __future__ import annotations

from datetime import time
from decimal import Decimal as D

TIMEZONE = "America/New_York"

# weekday 0=Mon .. 6=Sun ; (opens, closes)
BRANCHES = [
    dict(
        code="DT",
        slug="downtown-flagship",
        name="Downtown Flagship",
        sort=10,
        pickup=True,
        delivery=True,
        prep=10,
        description="Our flagship café-bar and roastery counter: full menu, bean bar and a big front window.",
        address="100 Placeholder Avenue",
        city="Harbour City",
        postal="00001",
        phone="+1 555 010 0101",
        email="downtown@lantern.example",
        lat="40.712800",
        lng="-74.006000",
        hours={
            **{d: (time(6, 30), time(20, 0)) for d in range(0, 5)},
            5: (time(7, 30), time(21, 0)),
            6: (time(8, 0), time(18, 0)),
        },
    ),
    dict(
        code="RS",
        slug="riverside",
        name="Riverside",
        sort=20,
        pickup=True,
        delivery=True,
        prep=12,
        description="A relaxed café on the water with a sunny terrace, pastries and a full filter menu.",
        address="22 Sample Quay",
        city="Harbour City",
        postal="00002",
        phone="+1 555 010 0102",
        email="riverside@lantern.example",
        lat="40.720100",
        lng="-74.015000",
        hours={
            **{d: (time(7, 0), time(19, 0)) for d in range(0, 5)},
            5: (time(8, 0), time(20, 0)),
            6: (time(8, 30), time(17, 0)),
        },
    ),
    dict(
        code="AK",
        slug="airport-kiosk",
        name="Airport Kiosk",
        sort=30,
        pickup=True,
        delivery=False,
        prep=6,
        description="A grab-and-go kiosk in the departures hall: espresso, filter, pastries and bagged beans. Pickup only.",
        address="Terminal 1, Departures (placeholder)",
        city="Harbour City",
        postal="00003",
        phone="+1 555 010 0103",
        email="airport@lantern.example",
        lat="40.641300",
        lng="-73.778100",
        hours={
            **{d: (time(7, 0), time(16, 0)) for d in range(0, 5)},
            5: (time(8, 0), time(15, 0)),
            6: (time(8, 0), time(15, 0)),
        },
    ),
]

# name, slug, {branch code: (fee, min order, free over, eta minutes)}
ZONES = [
    (
        "Old Town",
        "old-town",
        {"DT": (D("2.50"), D("10.00"), D("30.00"), 25), "RS": (D("3.50"), D("12.00"), D("35.00"), 35)},
    ),
    ("Midtown", "midtown", {"DT": (D("3.00"), D("12.00"), D("35.00"), 30)}),
    (
        "Harbour Quarter",
        "harbour-quarter",
        {"DT": (D("4.00"), D("15.00"), D("40.00"), 40), "RS": (D("2.50"), D("10.00"), D("30.00"), 25)},
    ),
    ("Riverside", "riverside-zone", {"RS": (D("2.00"), D("8.00"), D("25.00"), 20)}),
    (
        "University District",
        "university-district",
        {"RS": (D("3.00"), D("10.00"), D("30.00"), 30), "DT": (D("4.50"), D("15.00"), None, 45)},
    ),
]

# branch code -> product names that are switched off at that branch (BranchProduct rows)
BRANCH_UNAVAILABLE = {
    "AK": ["Nitro Cold Brew", "V60 Pour-Over", "Spinach & Feta Quiche", "Basque Cheesecake"],
    "RS": ["Cold Brew Tonic"],
}
