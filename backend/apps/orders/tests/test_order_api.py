import threading
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.utils import timezone

from apps.cart.tests.fixtures import add_to_cart, client_for, do_checkout, make_order
from apps.inventory.models import InventoryMovement, StockItem
from apps.orders.models import Order, OrderItemOption
from apps.orders.services import cancel_order, transition_order
from apps.payments.models import Payment
from apps.promotions.models import Coupon, CouponRedemption
from tests.factories import make_staff, make_user

pytestmark = pytest.mark.django_db
D = Decimal


def place(client, shop, **kw):
    return do_checkout(client, shop, **kw).data["order"]["number"]


# ── listing / detail / authorization ─────────────────────────────────────────────────────────────────────────────────


def test_orders_require_authentication(anon, customer, shop):
    order = make_order(shop, customer)
    assert anon.get("/api/v1/orders/").status_code == 401
    assert anon.get(f"/api/v1/orders/{order.number}/").status_code == 401
    assert anon.post(f"/api/v1/orders/{order.number}/cancel/").status_code == 401
    assert anon.post(f"/api/v1/orders/{order.number}/pay/").status_code == 401
    assert anon.post(f"/api/v1/orders/{order.number}/reorder/").status_code == 401


def test_list_is_paginated_newest_first_and_only_mine(auth, customer, shop):
    other = make_user()
    now = timezone.now()
    mine = [make_order(shop, customer, placed_at=now - timedelta(hours=i)) for i in range(5)]
    make_order(shop, other)
    r = auth.get("/api/v1/orders/?page_size=3")
    assert r.status_code == 200 and r.data["count"] == 5 and len(r.data["results"]) == 3
    assert [o["number"] for o in r.data["results"]] == [o.number for o in mine[:3]]
    assert r.data["next"] is not None
    r = auth.get("/api/v1/orders/?page_size=3&page=2")
    assert [o["number"] for o in r.data["results"]] == [o.number for o in mine[3:]]
    r = auth.get("/api/v1/orders/?ordering=placed_at")
    assert r.data["results"][0]["number"] == mine[-1].number


def test_list_filters_by_status(auth, customer, shop):
    make_order(shop, customer, status="PENDING")
    done = make_order(shop, customer, status="COMPLETED")
    make_order(shop, customer, status="CANCELLED")
    r = auth.get("/api/v1/orders/?status=COMPLETED")
    assert [o["number"] for o in r.data["results"]] == [done.number]
    assert auth.get("/api/v1/orders/?status=PENDING,CANCELLED").data["count"] == 2
    assert auth.get("/api/v1/orders/?order_type=DELIVERY").data["count"] == 0


def test_list_item_shape(auth, shop):
    add_to_cart(auth, shop.latte, [shop.size_small.id], 2)
    add_to_cart(auth, shop.beans)
    number = place(auth, shop)
    row = auth.get("/api/v1/orders/").data["results"][0]
    assert row["number"] == number and row["status"] == "PENDING" and row["item_count"] == 3
    assert row["items_preview"] == ["2 × Latte", "1 × House Beans"]
    assert row["branch"]["name"] == shop.branch.name and row["total"] == "20.50" and row["currency"] == "USD"
    assert "is_demo" in row


def test_list_query_count_does_not_grow_with_orders(auth, customer, shop, django_assert_max_num_queries):
    def build(n):
        for _ in range(n):
            o = make_order(shop, customer)
            for product in (shop.latte, shop.beans, shop.pastry):
                item = o.items.create(
                    product=product,
                    product_name=product.name,
                    sku=product.sku,
                    base_price="1",
                    unit_price="1",
                    quantity=1,
                    line_total="1",
                )
                OrderItemOption.objects.create(item=item, group_name="g", option_name="o")

    build(2)
    from django.db import connection as conn
    from django.test.utils import CaptureQueriesContext

    with CaptureQueriesContext(conn) as small:
        assert auth.get("/api/v1/orders/").status_code == 200
    build(8)
    with CaptureQueriesContext(conn) as large:
        assert auth.get("/api/v1/orders/").data["count"] == 10
    assert len(large) == len(small)
    with django_assert_max_num_queries(14):
        auth.get("/api/v1/orders/")


def test_detail_query_count_is_bounded(auth, shop, django_assert_max_num_queries):
    add_to_cart(auth, shop.latte, [shop.size_small.id, shop.oat.id], 2)
    add_to_cart(auth, shop.beans)
    add_to_cart(auth, shop.pastry)
    number = place(auth, shop)
    with django_assert_max_num_queries(16):
        assert auth.get(f"/api/v1/orders/{number}/").status_code == 200


def test_detail_shape(auth, shop):
    add_to_cart(auth, shop.latte, [shop.size_large.id], 1)
    number = place(auth, shop)
    d = auth.get(f"/api/v1/orders/{number}/").data
    assert d["number"] == number and d["branch"]["code"] == "DT" and d["branch"]["timezone"] == "UTC"
    assert d["payment"]["provider"] == "cash" and d["payment"]["status"] == "PENDING"
    assert [s["status"] for s in d["timeline"]] == [
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "READY_FOR_PICKUP",
        "COMPLETED",
    ]
    assert d["history"][0]["to_status"] == "PENDING"
    assert set(d["actions"]) == {"can_cancel", "can_pay", "can_reorder", "can_review"}
    assert d["tax_rate"] == "0.00" and d["prices_include_tax"] is False and "is_demo" in d


def test_customer_cannot_see_or_touch_another_customers_order(auth, shop):
    other_client = client_for(make_user())
    add_to_cart(other_client, shop.beans)
    number = place(other_client, shop)
    assert auth.get(f"/api/v1/orders/{number}/").status_code == 404
    assert auth.post(f"/api/v1/orders/{number}/cancel/").status_code == 404
    assert auth.post(f"/api/v1/orders/{number}/pay/").status_code == 404
    assert auth.post(f"/api/v1/orders/{number}/reorder/").status_code == 404
    assert auth.get("/api/v1/orders/").data["count"] == 0
    assert Order.objects.get(number=number).status == "PENDING"
    assert auth.get("/api/v1/orders/NOPE-1/").status_code == 404


def test_staff_notes_in_history_are_hidden_from_customers(auth, customer, shop):
    order = make_order(shop, customer)
    staff = make_staff("ADMIN")
    transition_order(order.pk, "CONFIRMED", actor=staff, note="customer is a VIP, call him")
    hist = auth.get(f"/api/v1/orders/{order.number}/").data["history"]
    assert hist[-1]["actor"] == "staff" and hist[-1]["note"] == ""


# ── timeline ─────────────────────────────────────────────────────────────────────────────────────────────────────────


def states(data):
    return [(s["status"], s["state"]) for s in data["timeline"]]


def test_pickup_timeline_progress(auth, customer, shop):
    order = make_order(shop, customer, order_type="PICKUP")
    transition_order(order.pk, "CONFIRMED", actor="system")
    transition_order(order.pk, "PREPARING", actor="system")
    d = auth.get(f"/api/v1/orders/{order.number}/").data
    assert states(d) == [
        ("PENDING", "done"),
        ("CONFIRMED", "done"),
        ("PREPARING", "current"),
        ("READY_FOR_PICKUP", "upcoming"),
        ("COMPLETED", "upcoming"),
    ]
    assert d["timeline"][0]["at"] is not None and d["timeline"][1]["at"] is not None and d["timeline"][3]["at"] is None
    assert d["timeline"][3]["label"] == "Ready for pickup"


def test_delivery_timeline_uses_delivery_step(auth, customer, shop):
    order = make_order(shop, customer, order_type="DELIVERY", status="OUT_FOR_DELIVERY")
    d = auth.get(f"/api/v1/orders/{order.number}/").data
    assert [s["status"] for s in d["timeline"]] == [
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "OUT_FOR_DELIVERY",
        "COMPLETED",
    ]
    assert dict(states(d))["OUT_FOR_DELIVERY"] == "current"


def test_completed_and_cancelled_timelines(auth, customer, shop):
    done = make_order(shop, customer, status="COMPLETED")
    assert {s for _, s in states(auth.get(f"/api/v1/orders/{done.number}/").data)} == {"done"}
    order = make_order(shop, customer)
    transition_order(order.pk, "CONFIRMED", actor="system")
    cancel_order(order.pk, actor="system", reason="x")
    d = auth.get(f"/api/v1/orders/{order.number}/").data
    assert states(d) == [("PENDING", "done"), ("CONFIRMED", "done"), ("CANCELLED", "cancelled")]
    assert d["timeline"][-1]["at"] is not None and d["cancel_reason"] == "x"


def test_actions_flags(auth, customer, shop):
    pending_cash = make_order(shop, customer)
    a = auth.get(f"/api/v1/orders/{pending_cash.number}/").data["actions"]
    assert a == {
        "can_cancel": True,
        "can_pay": False,
        "can_reorder": False,
        "can_review": False,
    }  # no items -> no reorder
    unpaid = make_order(shop, customer, method="demo", payment_status="FAILED")
    assert auth.get(f"/api/v1/orders/{unpaid.number}/").data["actions"]["can_pay"] is True
    paid = make_order(shop, customer, method="demo", payment_status="PAID", status="CONFIRMED")
    a = auth.get(f"/api/v1/orders/{paid.number}/").data["actions"]
    assert a["can_pay"] is False and a["can_cancel"] is False


def test_can_review_after_completion_until_reviewed(auth, customer, shop):
    from apps.catalog.models import Review

    add_to_cart(auth, shop.pastry)
    number = place(auth, shop)
    order = Order.objects.get(number=number)
    assert auth.get(f"/api/v1/orders/{number}/").data["actions"]["can_review"] is False
    Order.objects.filter(pk=order.pk).update(status="COMPLETED")
    d = auth.get(f"/api/v1/orders/{number}/").data
    assert d["actions"]["can_review"] is True and d["actions"]["can_reorder"] is True
    Review.objects.create(product=shop.pastry, user=customer, rating=5)
    assert auth.get(f"/api/v1/orders/{number}/").data["actions"]["can_review"] is False


# ── cancel ───────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_customer_cancel_restores_stock_and_voids_coupon(auth, customer, shop):
    coupon = Coupon.objects.create(
        code="TEN", name="Ten", discount_type="PERCENT", value=D("10"), usage_limit=3, per_customer_limit=1
    )
    add_to_cart(auth, shop.beans, quantity=4)
    number = place(auth, shop, coupon_code="TEN")
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 6
    r = auth.post(f"/api/v1/orders/{number}/cancel/", {"reason": "Wrong branch"}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["order"]["status"] == "CANCELLED" and r.data["order"]["cancel_reason"] == "Wrong branch"
    assert r.data["refund_status"] == "not_applicable"
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 10
    assert InventoryMovement.objects.filter(movement_type="RETURN", reference=number).count() == 1
    coupon.refresh_from_db()
    assert coupon.times_redeemed == 0 and CouponRedemption.objects.get().is_voided is True
    # the voided redemption frees the per-customer allowance
    add_to_cart(auth, shop.beans)
    again = do_checkout(auth, shop, coupon_code="TEN")
    assert again.status_code == 201
    # second cancel is an idempotent no-op: no double restore
    r = auth.post(f"/api/v1/orders/{number}/cancel/")
    assert r.status_code == 200 and r.data["order"]["status"] == "CANCELLED"
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 9
    coupon.refresh_from_db()
    assert coupon.times_redeemed == 1


def test_cancel_after_confirmation_is_refused(auth, customer, shop):
    add_to_cart(auth, shop.beans)
    number = place(auth, shop)
    order = Order.objects.get(number=number)
    transition_order(order.pk, "CONFIRMED", actor="system")
    r = auth.post(f"/api/v1/orders/{number}/cancel/")
    assert r.status_code == 409 and r.data["error"]["code"] == "invalid_transition"
    assert Order.objects.get(number=number).status == "CONFIRMED"
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 9


def test_cancel_of_a_paid_order_hints_at_staff_refund_review(auth, customer, shop):
    order = make_order(shop, customer, method="demo", payment_status="PAID")
    r = auth.post(f"/api/v1/orders/{order.number}/cancel/")
    assert r.status_code == 200
    assert r.data["refund_status"] == "review_pending" and "review" in r.data["refund_message"].lower()
    order.refresh_from_db()
    assert order.status == "CANCELLED" and order.refunded_total == 0 and order.payment_status == "PAID"


def test_cancel_closes_open_payment_attempts(auth, shop, django_capture_on_commit_callbacks):
    add_to_cart(auth, shop.beans)
    number = place(auth, shop, payment_method="demo")
    assert Payment.objects.get().status == "REQUIRES_ACTION"
    with django_capture_on_commit_callbacks(execute=True):
        assert auth.post(f"/api/v1/orders/{number}/cancel/").status_code == 200
    assert Payment.objects.get().status == "CANCELLED"


def test_cancel_with_reason_too_long_is_rejected(auth, customer, shop):
    order = make_order(shop, customer)
    assert auth.post(f"/api/v1/orders/{order.number}/cancel/", {"reason": "x" * 201}, format="json").status_code == 400


@pytest.mark.django_db(transaction=True)
def test_concurrent_cancels_restore_stock_once(auth, shop):
    add_to_cart(auth, shop.beans, quantity=3)
    number = place(auth, shop)
    clients = [client_for(Order.objects.get(number=number).customer) for _ in range(5)]
    codes = []
    barrier = threading.Barrier(5)

    def worker(c):
        try:
            barrier.wait()
            codes.append(c.post(f"/api/v1/orders/{number}/cancel/").status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(c,)) for c in clients]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert codes == [200] * 5
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 10
    assert InventoryMovement.objects.filter(movement_type="RETURN").count() == 1


def test_staff_cancel_restores_stock_too(auth, shop):
    add_to_cart(auth, shop.beans, quantity=2)
    number = place(auth, shop)
    order = Order.objects.get(number=number)
    transition_order(order.pk, "CONFIRMED", actor="system")
    cancel_order(order.pk, actor=make_staff("ADMIN"), reason="Machine broke")
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 10


# ── reorder ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_reorder_adds_valid_lines_and_reports_skipped(auth, shop):
    add_to_cart(auth, shop.latte, [shop.size_large.id, shop.oat.id], 2, note="hot")
    add_to_cart(auth, shop.beans, quantity=1)
    add_to_cart(auth, shop.pastry, quantity=1)
    number = place(auth, shop)
    shop.pastry.is_sold_out = True
    shop.pastry.save()
    r = auth.post(f"/api/v1/orders/{number}/reorder/")
    assert r.status_code == 200, r.data
    names = {i["product"]["name"]: i for i in r.data["cart"]["items"]}
    assert set(names) == {"Latte", "House Beans"}
    assert names["Latte"]["quantity"] == 2 and names["Latte"]["note"] == "hot"
    assert [o["name"] for o in names["Latte"]["options"]] == ["Large", "Oat"]
    assert r.data["skipped"] == [{"name": "Croissant", "reason": "sold_out", "message": "Croissant is sold out."}]
    # reordering again merges into the same lines (quantities add up)
    r = auth.post(f"/api/v1/orders/{number}/reorder/")
    assert {i["product"]["name"]: i["quantity"] for i in r.data["cart"]["items"]} == {"Latte": 4, "House Beans": 2}


def test_reorder_skips_removed_products_and_options(auth, shop):
    add_to_cart(auth, shop.latte, [shop.size_small.id, shop.soy.id], 1)
    add_to_cart(auth, shop.pastry)
    number = place(auth, shop)
    shop.soy.delete()
    shop.pastry.delete()
    r = auth.post(f"/api/v1/orders/{number}/reorder/")
    assert r.status_code == 200 and r.data["cart"]["items"] == []
    assert {(s["name"], s["reason"]) for s in r.data["skipped"]} == {
        ("Latte", "option_removed"),
        ("Croissant", "product_removed"),
    }


def test_reorder_uses_current_prices(auth, shop):
    add_to_cart(auth, shop.pastry, quantity=2)
    number = place(auth, shop)
    shop.pastry.base_price = D("5.00")
    shop.pastry.save()
    r = auth.post(f"/api/v1/orders/{number}/reorder/")
    assert r.data["cart"]["items"][0]["unit_price"] == "5.00" and r.data["cart"]["subtotal"] == "10.00"


# ── pay ──────────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_pay_is_idempotent_while_an_attempt_is_open(auth, shop):
    add_to_cart(auth, shop.beans)
    number = place(auth, shop, payment_method="demo")
    first = Payment.objects.get()
    r = auth.post(f"/api/v1/orders/{number}/pay/")
    assert r.status_code == 200
    assert r.data["status"] == "REQUIRES_ACTION" and r.data["action"]["type"] == "redirect"
    assert r.data["error"] is None
    assert Payment.objects.count() == 1 and Payment.objects.get().pk == first.pk


def test_pay_after_failure_creates_a_fresh_attempt(auth, shop):
    add_to_cart(auth, shop.beans)
    number = place(auth, shop, payment_method="demo")
    order = Order.objects.get(number=number)
    Payment.objects.filter(order=order).update(status="FAILED", failure_message="declined")
    Order.objects.filter(pk=order.pk).update(payment_status="FAILED")
    r = auth.post(f"/api/v1/orders/{number}/pay/", {}, format="json")
    assert r.status_code == 200 and r.data["status"] == "REQUIRES_ACTION"
    assert Payment.objects.filter(order=order).count() == 2
    assert Payment.objects.filter(order=order, status="REQUIRES_ACTION").count() == 1


def test_pay_can_switch_method(auth, shop):
    add_to_cart(auth, shop.beans)
    number = place(auth, shop, payment_method="demo")
    r = auth.post(f"/api/v1/orders/{number}/pay/", {"payment_method": "cash"}, format="json")
    assert r.status_code == 200 and r.data["provider"] == "cash"
    assert Order.objects.get(number=number).payment_method == "cash"
    assert auth.post(f"/api/v1/orders/{number}/pay/", {"payment_method": "bitcoin"}, format="json").status_code == 400


def test_pay_refused_when_settled_cancelled_or_completed(auth, customer, shop):
    paid = make_order(shop, customer, method="demo", payment_status="PAID", status="PENDING")
    r = auth.post(f"/api/v1/orders/{paid.number}/pay/")
    assert r.status_code == 409 and r.data["error"]["code"] == "already_paid"
    for status in ("CANCELLED", "COMPLETED", "CONFIRMED"):
        order = make_order(shop, customer, method="demo", status=status)
        r = auth.post(f"/api/v1/orders/{order.number}/pay/")
        assert r.status_code == 409 and r.data["error"]["code"] == "order_not_payable", status
    assert Payment.objects.count() == 0


def test_pay_provider_failure_is_reported_as_error_status(auth, shop, monkeypatch):
    from apps.core.errors import DomainError

    add_to_cart(auth, shop.beans)
    number = place(auth, shop, payment_method="demo")

    def boom(order, provider_key, *, return_url, cancel_url):
        raise DomainError("Provider down", code="payment_provider_unavailable", status_code=502)

    monkeypatch.setattr("apps.payments.services.start_payment", boom)
    r = auth.post(f"/api/v1/orders/{number}/pay/")
    assert r.status_code == 502 and r.data["error"]["code"] == "payment_provider_unavailable"
    assert Order.objects.get(number=number).status == "PENDING"


# ── expiry ───────────────────────────────────────────────────────────────────────────────────────────────────────────


def aged(order, minutes):
    Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(minutes=minutes))


def test_expire_unpaid_orders(auth, customer, shop, settings):
    from apps.orders.tasks import expire_unpaid_orders

    settings.UNPAID_ORDER_EXPIRY_MINUTES = 30
    coupon = Coupon.objects.create(code="TEN", name="Ten", discount_type="PERCENT", value=D("10"))
    add_to_cart(auth, shop.beans, quantity=2)
    stale_number = place(auth, shop, payment_method="demo", coupon_code="TEN")
    stale = Order.objects.get(number=stale_number)
    aged(stale, 31)
    fresh = make_order(shop, customer, method="demo", placed_at=timezone.now() - timedelta(minutes=5))
    cash = make_order(shop, customer, method="cash")
    aged(cash, 600)
    paid = make_order(shop, customer, method="demo", payment_status="PAID")
    aged(paid, 600)
    confirmed = make_order(shop, customer, method="demo", status="CONFIRMED", payment_status="PENDING")
    aged(confirmed, 600)
    failed = make_order(shop, customer, method="demo", payment_status="FAILED")
    aged(failed, 120)

    assert expire_unpaid_orders() == 2
    statuses = {o.number: o.status for o in Order.objects.all()}
    assert statuses[stale_number] == "CANCELLED" and statuses[failed.number] == "CANCELLED"
    assert statuses[fresh.number] == "PENDING" and statuses[cash.number] == "PENDING"
    assert statuses[paid.number] == "PENDING" and statuses[confirmed.number] == "CONFIRMED"
    stale.refresh_from_db()
    assert stale.cancel_reason == "Payment not completed" and stale.cancelled_at
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 10
    coupon.refresh_from_db()
    assert coupon.times_redeemed == 0 and CouponRedemption.objects.get().is_voided
    entry = stale.history.last()
    assert (entry.to_status, entry.actor_label) == ("CANCELLED", "system")
    assert expire_unpaid_orders() == 0  # idempotent


def test_expiry_skips_orders_locked_by_someone_else(customer, shop, settings, transactional_db):
    from apps.orders.tasks import expire_unpaid_orders

    order = make_order(shop, customer, method="demo")
    aged(order, 600)
    locked = threading.Event()
    release = threading.Event()

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
        assert expire_unpaid_orders() == 0  # does not block, does not touch the locked order
    finally:
        release.set()
        t.join()
    assert expire_unpaid_orders() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_expiry_runs_cancel_each_order_once(customer, shop):
    from apps.orders.tasks import expire_unpaid_orders

    add_to_cart(client_for(customer), shop.beans, quantity=2)
    number = place(client_for(customer), shop, payment_method="demo")
    aged(Order.objects.get(number=number), 600)
    totals = []
    barrier = threading.Barrier(4)

    def run():
        try:
            barrier.wait()
            totals.append(expire_unpaid_orders())
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sum(totals) == 1
    assert StockItem.objects.get(pk=shop.beans_stock.pk).quantity == 10
    assert InventoryMovement.objects.filter(movement_type="RETURN").count() == 1
