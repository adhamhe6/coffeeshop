"""Finding S8: unconfirmed cash orders expire, and a customer can only hold a few of them at once."""

import threading
import time
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.utils import timezone

from apps.cart.tests.fixtures import add_to_cart, client_for, do_checkout, make_order
from apps.inventory.models import StockItem
from apps.notifications.models import Notification
from apps.orders.models import Order
from apps.orders.tasks import CASH_EXPIRY_REASON, expire_unconfirmed_cash_orders, expire_unpaid_orders
from apps.promotions.models import Coupon, CouponRedemption
from tests.factories import make_user

pytestmark = pytest.mark.django_db
D = Decimal


def aged(order, minutes):
    Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(minutes=minutes))


def place(client, shop, **kw):
    return do_checkout(client, shop, **kw).data["order"]["number"]


# ── expiry ───────────────────────────────────────────────────────────────────────────────────────────────────────────


class TestCashExpiry:
    def test_unconfirmed_cash_orders_are_cancelled_with_all_side_effects(
        self, auth, customer, shop, settings, django_capture_on_commit_callbacks
    ):
        settings.CASH_ORDER_EXPIRY_MINUTES = 120
        coupon = Coupon.objects.create(code="TEN", name="Ten", discount_type="PERCENT", value=D("10"))
        add_to_cart(auth, shop.beans, quantity=2)
        stale = Order.objects.get(number=place(auth, shop, payment_method="cash", coupon_code="TEN"))
        assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 8
        aged(stale, 121)
        fresh = make_order(shop, customer, method="cash", placed_at=timezone.now() - timedelta(minutes=119))
        confirmed = make_order(shop, customer, method="cash", status="CONFIRMED")
        aged(confirmed, 600)
        collected = make_order(shop, customer, method="cash", payment_status="PAID")
        aged(collected, 600)

        with django_capture_on_commit_callbacks(execute=True):
            assert expire_unconfirmed_cash_orders() == 1

        stale.refresh_from_db()
        assert stale.status == "CANCELLED" and stale.cancel_reason == CASH_EXPIRY_REASON == (
            "Not confirmed by the branch in time"
        )
        assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 10
        coupon.refresh_from_db()
        assert coupon.times_redeemed == 0 and CouponRedemption.objects.get().is_voided
        entry = stale.history.last()
        assert (entry.to_status, entry.actor_label, entry.actor_id) == ("CANCELLED", "system", None)
        assert Notification.objects.filter(order=stale, kind="order_cancelled", user=customer).count() == 1
        for untouched, status in ((fresh, "PENDING"), (confirmed, "CONFIRMED"), (collected, "PENDING")):
            untouched.refresh_from_db()
            assert untouched.status == status
        assert expire_unconfirmed_cash_orders() == 0  # idempotent
        assert Notification.objects.filter(order=stale, kind="order_cancelled").count() == 1

    def test_the_two_expiry_tasks_do_not_touch_each_others_orders(self, customer, shop):
        cash = make_order(shop, customer, method="cash")
        online = make_order(shop, customer, method="demo")
        aged(cash, 600)
        aged(online, 600)
        assert expire_unpaid_orders() == 1
        cash.refresh_from_db()
        online.refresh_from_db()
        assert (cash.status, online.status) == ("PENDING", "CANCELLED")
        assert expire_unconfirmed_cash_orders() == 1
        cash.refresh_from_db()
        assert cash.status == "CANCELLED"

    def test_expiry_window_is_configurable(self, customer, shop, settings):
        order = make_order(shop, customer, method="cash")
        aged(order, 30)
        assert expire_unconfirmed_cash_orders() == 0
        settings.CASH_ORDER_EXPIRY_MINUTES = 20
        assert expire_unconfirmed_cash_orders() == 1

    def test_scheduled_orders_expire_relative_to_the_requested_slot(self, customer, shop, settings):
        settings.CASH_ORDER_EXPIRY_MINUTES = 120
        shop.branch.prep_minutes = 15
        shop.branch.save()
        now = timezone.now()
        # booked long ago for tomorrow: the grace period passed, but the branch can still start preparing later
        future = make_order(shop, customer, method="cash", requested_for=now + timedelta(hours=24))
        aged(future, 600)
        # slot starts (requested_for - prep) in 10 minutes: still confirmable
        soon = make_order(shop, customer, method="cash", requested_for=now + timedelta(minutes=25))
        aged(soon, 600)
        # slot start passed 5 minutes ago and the grace period is over: expire
        missed = make_order(shop, customer, method="cash", requested_for=now + timedelta(minutes=10))
        aged(missed, 600)
        # slot start already passed, but the order is only 10 minutes old: grace period protects it
        booked_late = make_order(shop, customer, method="cash", requested_for=now + timedelta(minutes=5))
        aged(booked_late, 10)

        assert expire_unconfirmed_cash_orders() == 1
        status = {o.pk: o.status for o in Order.objects.all()}
        assert status[missed.pk] == "CANCELLED"
        assert status[future.pk] == status[soon.pk] == status[booked_late.pk] == "PENDING"
        # once the slot start of the day-ahead order passes it expires too
        Order.objects.filter(pk=future.pk).update(requested_for=now + timedelta(minutes=14))
        assert expire_unconfirmed_cash_orders() == 1
        future.refresh_from_db()
        assert future.status == "CANCELLED"

    def test_batches_are_not_starved_by_scheduled_orders(self, customer, shop):
        for _ in range(3):
            far = make_order(shop, customer, method="cash", requested_for=timezone.now() + timedelta(days=2))
            aged(far, 900)
        stale = make_order(shop, customer, method="cash")
        aged(stale, 900)
        assert expire_unconfirmed_cash_orders(batch_size=2) == 1

    def test_skips_orders_locked_by_someone_else(self, customer, shop, transactional_db):
        order = make_order(shop, customer, method="cash")
        aged(order, 600)
        locked, release = threading.Event(), threading.Event()

        def holder():
            from django.db import transaction

            try:
                with transaction.atomic():
                    Order.objects.select_for_update().get(pk=order.pk)
                    locked.set()
                    release.wait(10)
            finally:
                connection.close()

        t = threading.Thread(target=holder)
        t.start()
        assert locked.wait(10)
        try:
            assert expire_unconfirmed_cash_orders() == 0
        finally:
            release.set()
            t.join()
        assert expire_unconfirmed_cash_orders() == 1

    def test_task_is_scheduled(self):
        from django.conf import settings

        tasks = {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()}
        assert "apps.orders.tasks.expire_unconfirmed_cash_orders" in tasks


@pytest.mark.django_db(transaction=True)
def test_concurrent_cash_expiry_runs_cancel_each_order_once(customer, shop):
    add_to_cart(client_for(customer), shop.beans, quantity=2)
    order = Order.objects.get(number=place(client_for(customer), shop, payment_method="cash"))
    aged(order, 600)
    totals = []
    barrier = threading.Barrier(4)

    def run():
        try:
            barrier.wait()
            totals.append(expire_unconfirmed_cash_orders())
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sum(totals) == 1
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 10


# ── cap on open cash orders ──────────────────────────────────────────────────────────────────────────────────────────


class TestOpenCashOrderCap:
    def test_default_is_three(self, settings):
        assert settings.MAX_OPEN_CASH_ORDERS_PER_CUSTOMER == 3
        assert settings.CASH_ORDER_EXPIRY_MINUTES == 120

    def fill(self, shop, customer, n, **kw):
        return [make_order(shop, customer, method="cash", **kw) for _ in range(n)]

    def test_checkout_is_refused_at_the_cap(self, auth, customer, shop):
        self.fill(shop, customer, 3)
        add_to_cart(auth, shop.pastry)
        r = do_checkout(auth, shop, payment_method="cash")
        assert r.status_code == 409 and r.data["error"]["code"] == "too_many_open_cash_orders"
        assert r.data["error"]["limit"] == 3
        assert Order.objects.filter(customer=customer).count() == 3
        assert auth.get("/api/v1/cart/").data["item_count"] == 1  # the cart is untouched so the customer can pay online
        assert do_checkout(auth, shop, payment_method="demo").status_code == 201

    def test_below_the_cap_checkout_works(self, auth, customer, shop):
        self.fill(shop, customer, 2)
        add_to_cart(auth, shop.pastry)
        assert do_checkout(auth, shop, payment_method="cash").status_code == 201

    def test_only_pending_cash_orders_count(self, auth, customer, shop):
        self.fill(shop, customer, 1)
        self.fill(shop, customer, 1, status="CONFIRMED")
        self.fill(shop, customer, 1, status="CANCELLED")
        self.fill(shop, customer, 1, status="COMPLETED")
        make_order(shop, customer, method="demo")
        make_order(shop, customer, method="stripe")
        other = make_user()
        make_order(shop, other, method="cash")
        make_order(shop, other, method="cash")
        make_order(shop, other, method="cash")
        add_to_cart(auth, shop.pastry)
        assert do_checkout(auth, shop, payment_method="cash").status_code == 201

    def test_cancelling_or_confirming_frees_a_slot(self, auth, customer, shop):
        orders = self.fill(shop, customer, 3)
        add_to_cart(auth, shop.pastry)
        assert do_checkout(auth, shop, payment_method="cash").status_code == 409
        assert auth.post(f"/api/v1/orders/{orders[0].number}/cancel/").status_code == 200
        assert do_checkout(auth, shop, payment_method="cash").status_code == 201

    def test_online_checkout_is_never_capped(self, auth, customer, shop):
        self.fill(shop, customer, 3)
        add_to_cart(auth, shop.pastry)
        assert do_checkout(auth, shop, payment_method="demo").status_code == 201

    def test_idempotent_replay_still_returns_the_original_order(self, auth, customer, shop):
        self.fill(shop, customer, 2)
        add_to_cart(auth, shop.pastry)
        first = do_checkout(auth, shop, key="replay-key-0001", payment_method="cash")
        assert first.status_code == 201
        again = do_checkout(auth, shop, key="replay-key-0001", payment_method="cash")
        assert again.status_code == 200 and again.data["order"]["number"] == first.data["order"]["number"]

    def test_limit_is_configurable(self, auth, customer, shop, settings):
        settings.MAX_OPEN_CASH_ORDERS_PER_CUSTOMER = 1
        self.fill(shop, customer, 1)
        add_to_cart(auth, shop.pastry)
        assert do_checkout(auth, shop, payment_method="cash").status_code == 409

    def test_free_orders_forced_to_cash_count_too(self, auth, customer, shop):
        Coupon.objects.create(code="FREE", name="Free", discount_type="PERCENT", value=D("100"))
        self.fill(shop, customer, 3)
        add_to_cart(auth, shop.pastry)
        r = do_checkout(auth, shop, payment_method="demo", coupon_code="FREE")
        assert r.status_code == 409 and r.data["error"]["code"] == "too_many_open_cash_orders"

    def test_switching_an_order_to_cash_is_capped(self, auth, customer, shop):
        self.fill(shop, customer, 3)
        online = make_order(shop, customer, method="demo")
        r = auth.post(f"/api/v1/orders/{online.number}/pay/", {"payment_method": "cash"}, format="json")
        assert r.status_code == 409 and r.data["error"]["code"] == "too_many_open_cash_orders"
        online.refresh_from_db()
        assert online.payment_method == "demo"

    def test_switching_below_the_cap_works_and_cash_orders_can_retry_cash(self, auth, customer, shop):
        existing = self.fill(shop, customer, 2)
        online = make_order(shop, customer, method="demo")
        r = auth.post(f"/api/v1/orders/{online.number}/pay/", {"payment_method": "cash"}, format="json")
        assert r.status_code == 200
        online.refresh_from_db()
        assert online.payment_method == "cash"
        # at the cap now, but an order that is already cash is not "switched": retrying it must keep working
        r = auth.post(f"/api/v1/orders/{existing[0].number}/pay/", {"payment_method": "cash"}, format="json")
        assert r.status_code == 200


@pytest.mark.django_db(transaction=True)
class TestCapUnderConcurrency:
    def test_parallel_switches_and_checkouts_never_exceed_the_cap(self, customer, shop, monkeypatch):
        from apps.orders import services

        original = services.assert_cash_capacity

        def slow_check(*args, **kwargs):  # widen the check-then-write window: only the customer lock keeps this safe
            original(*args, **kwargs)
            time.sleep(0.3)

        monkeypatch.setattr(services, "assert_cash_capacity", slow_check)
        for _ in range(2):
            make_order(shop, customer, method="cash")
        online = [make_order(shop, customer, method="demo") for _ in range(4)]
        add_to_cart(client_for(customer), shop.pastry)
        outcomes = []
        barrier = threading.Barrier(5)

        def switch(order):
            try:
                barrier.wait()
                r = client_for(customer).post(
                    f"/api/v1/orders/{order.number}/pay/", {"payment_method": "cash"}, format="json"
                )
                outcomes.append((r.status_code, r.data.get("error", {}).get("code") if r.status_code >= 400 else None))
            finally:
                connection.close()

        def checkout():
            try:
                barrier.wait()
                r = do_checkout(client_for(customer), shop, payment_method="cash")
                outcomes.append((r.status_code, r.data.get("error", {}).get("code") if r.status_code >= 400 else None))
            finally:
                connection.close()

        threads = [threading.Thread(target=switch, args=(o,)) for o in online] + [threading.Thread(target=checkout)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert len(outcomes) == 5
        assert sum(1 for status, _ in outcomes if status in (200, 201)) == 1, outcomes
        assert all(code == "too_many_open_cash_orders" for status, code in outcomes if status >= 400), outcomes
        assert Order.objects.filter(customer=customer, payment_method="cash", status="PENDING").count() == 3

    def test_parallel_checkouts_with_distinct_keys_create_one_order_per_cart(self, customer, shop):
        """Eight simultaneous checkouts (distinct idempotency keys) share one cart: exactly one order, no 500s."""
        add_to_cart(client_for(customer), shop.pastry, quantity=1)
        results = []
        barrier = threading.Barrier(8)

        def run(i):
            try:
                barrier.wait()
                r = do_checkout(client_for(customer), shop, key=f"parallel-key-{i:04d}", payment_method="cash")
                results.append(r.status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(i,)) for i in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert results.count(201) == 1 and set(results) <= {201, 400, 409}  # the rest see an empty cart
        assert Order.objects.filter(customer=customer, payment_method="cash").count() == 1
