from __future__ import annotations

import datetime as dt
from decimal import Decimal as D
from types import SimpleNamespace

import pytest
from django.core.cache import cache

from tests.factories import make_branch, make_product, make_staff, make_stock, make_user

from .helpers import (
    BEANS,
    CAKE,
    COFFEE,
    Expected,
    make_coupon,
    make_movement,
    make_order,
    make_payment,
    make_refund,
    utc,
)

# The reporting window used throughout: 2026-09-01 .. 2026-09-30 (30 days). Previous period: 2026-08-02 .. 2026-08-31.
D_FROM = dt.date(2026, 9, 1)
D_TO = dt.date(2026, 9, 30)
P_FROM = dt.date(2026, 8, 2)
P_TO = dt.date(2026, 8, 31)


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def world(db):
    """Three branches in three time zones, customers, a deterministic set of orders around the period edges,
    payments, refunds, coupon redemptions, stock and movements. `w.expected` is the independent Python oracle."""
    a = make_branch("DT", name="Downtown", timezone="UTC")
    b = make_branch("TK", name="Tokyo", timezone="Asia/Tokyo")
    c = make_branch("NY", name="New York", timezone="America/New_York")
    cust = [
        make_user(f"cust{i}@example.com", first_name=n, last_name=ln, phone=f"+1555010{i}{i}{i}{i}")
        for i, (n, ln) in enumerate(
            [("Alice", "Anderson"), ("Bob", "Brown"), ("Carla", "Diaz"), ("Dmitri", "Evans"), ("Eve", "Foster")],
            start=1,
        )
    ]
    alice, bob, carla, dmitri, eve = cust
    save10 = make_coupon("SAVE10")
    ex = Expected()
    add = ex.specs.append

    # ── Downtown (UTC) ───────────────────────────────────────────────────────────────────────────────────────────
    add(make_order(a, alice, utc(2026, 9, 1, 10), [COFFEE(2), BEANS(1, "1.00")], tax="1.00"))  # counted, discount 1
    add(
        make_order(a, bob, utc(2026, 9, 1, 23, 59, 59), [COFFEE()], status="CONFIRMED")
    )  # counted, last second of Sep 1
    add(
        make_order(
            a,
            alice,
            utc(2026, 9, 2, 0, 0, 0),
            [CAKE(2)],
            status="PREPARING",
            order_type="DELIVERY",
            delivery_fee="3.00",
        )
    )
    add(
        make_order(a, carla, utc(2026, 9, 5, 9), [COFFEE()], status="PENDING", payment_status="PENDING")
    )  # unpaid: not counted
    add(
        make_order(a, bob, utc(2026, 9, 6, 9), [BEANS(2)], status="CANCELLED", payment_status="PAID")
    )  # cancelled but paid
    add(
        make_order(
            a,
            dmitri,
            utc(2026, 9, 7, 9),
            [COFFEE(3)],
            status="COMPLETED",
            payment_status="PENDING",
            payment_method="cash",
            payment=False,
        )
    )
    add(
        make_order(
            a,
            eve,
            utc(2026, 9, 8, 9),
            [BEANS(1)],
            status="COMPLETED",
            payment_status="REFUNDED",
            refunded="14.00",
            tax="0.50",
        )
    )
    add(
        make_order(
            a, alice, utc(2026, 9, 10, 9), [COFFEE(2), CAKE(1)], payment_status="PARTIALLY_REFUNDED", refunded="2.00"
        )
    )
    failed = make_order(
        a, carla, utc(2026, 9, 12, 9), [BEANS(1)], status="PENDING", payment_status="FAILED"
    )  # failed attempt only
    add(failed)
    make_payment(
        failed.order,
        status="FAILED",
        provider="stripe",
        created_at=utc(2026, 9, 12, 9, 5),
        failure_code="card_declined",
    )
    add(
        make_order(
            a,
            dmitri,
            utc(2026, 9, 15, 9),
            [COFFEE()],
            status="CONFIRMED",
            payment_status="PENDING",
            payment_method="cash",
            payment=False,
        )
    )
    add(
        make_order(a, bob, utc(2026, 9, 20, 9), [BEANS(1, "1.40"), COFFEE(2, "0.70")], is_demo=True, coupon=save10)
    )  # coupon + demo
    # previous period (08-02 .. 08-31) and outside the window
    add(make_order(a, alice, utc(2026, 8, 20, 9), [COFFEE(2)]))
    add(make_order(a, bob, utc(2026, 8, 25, 9), [BEANS(1), CAKE(1)], tax="0.40"))
    add(
        make_order(
            a,
            carla,
            utc(2026, 8, 31, 23, 59, 59),
            [COFFEE()],
            status="CANCELLED",
            payment_status="PENDING",
            payment_method="cash",
            payment=False,
        )
    )
    add(make_order(a, eve, utc(2026, 10, 1, 0, 0, 0), [COFFEE()]))  # after
    add(make_order(a, eve, utc(2026, 7, 1, 9), [COFFEE()]))  # before previous period

    # ── Tokyo (UTC+9) ────────────────────────────────────────────────────────────────────────────────────────────
    add(make_order(b, alice, utc(2026, 8, 31, 15, 30), [BEANS(2)], tax="2.80"))  # 09-01 00:30 JST => in window
    add(make_order(b, carla, utc(2026, 9, 30, 14, 59, 59), [COFFEE(4)]))  # 09-30 23:59:59 JST => in
    add(make_order(b, carla, utc(2026, 9, 30, 15, 0, 0), [COFFEE()]))  # 10-01 00:00 JST => out
    add(make_order(b, dmitri, utc(2026, 8, 31, 14, 59), [CAKE()]))  # 08-31 23:59 JST => previous period

    # ── New York (UTC-4 in September) ────────────────────────────────────────────────────────────────────────────
    add(make_order(c, bob, utc(2026, 9, 1, 3, 30), [COFFEE()]))  # 08-31 23:30 EDT => previous period
    add(make_order(c, eve, utc(2026, 10, 1, 3, 30), [BEANS(1)], status="PREPARING"))  # 09-30 23:30 EDT => in
    add(make_order(c, eve, utc(2026, 9, 14, 16), [CAKE(2)], delivery_fee="2.00"))

    # refunds on real Payment rows
    refunded = ex.specs[6].order  # the REFUNDED order
    pay = refunded.payments.get()
    make_refund(pay, "14.00", created_at=utc(2026, 9, 9, 9))
    partial = ex.specs[7].order.payments.get()
    make_refund(partial, "2.00", created_at=utc(2026, 9, 11, 9))
    cancelled_paid = ex.specs[4].order.payments.get()
    make_refund(cancelled_paid, "5.00", status="PENDING", created_at=utc(2026, 9, 7, 9))  # partial, pending

    # stock + movements (STOCKED products)
    beans = make_product("Ethiopia Beans 250g", price="14.00", stocked=True)
    tea = make_product("Tin", price="9.00", stocked=True)
    mug = make_product("Mug", price="12.00", stocked=True)
    stock = {
        "beans_a": make_stock(a, beans, quantity=3, threshold=5),  # low
        "tea_a": make_stock(a, tea, quantity=0, threshold=2),  # out
        "mug_a": make_stock(a, mug, quantity=40, threshold=5),  # ok
        "beans_b": make_stock(b, beans, quantity=0, threshold=5),  # out
        "tea_b": make_stock(b, tea, quantity=2, threshold=2),  # low (<= threshold)
    }
    from apps.inventory.models import StockItem

    StockItem.objects.filter(pk=stock["beans_a"].pk).update(unit_cost=D("6.00"))
    StockItem.objects.filter(pk=stock["mug_a"].pk).update(unit_cost=D("4.50"))
    make_movement(stock["beans_a"], "RECEIPT", 20, utc(2026, 9, 3, 9))
    make_movement(stock["beans_a"], "SALE", -17, utc(2026, 9, 4, 9))
    make_movement(stock["mug_a"], "WASTE", -2, utc(2026, 9, 4, 9))
    make_movement(stock["beans_b"], "SALE", -4, utc(2026, 8, 31, 15, 30))  # 09-01 JST => in
    make_movement(stock["beans_b"], "SALE", -9, utc(2026, 8, 1, 9))  # outside

    users = SimpleNamespace(
        admin=make_staff("ADMIN"),
        super=make_staff("SUPER_ADMIN"),
        manager_a=make_staff("BRANCH_MANAGER", branches=[a]),
        manager_b=make_staff("BRANCH_MANAGER", branches=[b]),
        manager_ab=make_staff("BRANCH_MANAGER", branches=[a, b]),
        manager_none=make_staff("BRANCH_MANAGER"),
        order_manager=make_staff("ORDER_MANAGER", branches=[a]),
        support=make_staff("SUPPORT_AGENT", branches=[a]),
        marketing=make_staff("MARKETING_MANAGER"),
        inventory=make_staff("INVENTORY_MANAGER", branches=[a]),
        product=make_staff("PRODUCT_MANAGER"),
        customer=alice,
    )
    return SimpleNamespace(
        a=a, b=b, c=c, customers=cust, expected=ex, coupon=save10, users=users, stock=stock, products=(beans, tea, mug)
    )


@pytest.fixture
def get(api, login):
    """get(user, path, **params) -> response, logged in as `user` (None = anonymous)."""

    def _get(user, path, **params):
        api.logout()
        if user is not None:
            login(user)
        return api.get(f"/api/v1/{path}", params)

    return _get
