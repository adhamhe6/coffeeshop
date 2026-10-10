from datetime import UTC, datetime, timedelta

import pytest
from django.utils import timezone

from apps.core.models import AuditLog
from apps.core.testing import client_for
from apps.orders.models import Order, OrderNote, OrderStatusHistory
from apps.payments.models import Payment
from apps.payments.tests.helpers import block_stripe_network, make_order, make_payment, make_refund, settle
from tests.factories import make_branch, make_staff, make_user

LIST = "/api/v1/admin/orders/"


@pytest.fixture(autouse=True)
def _no_stripe_network(monkeypatch):
    block_stripe_network(monkeypatch)


@pytest.fixture
def branch_a():
    return make_branch("AAA", name="Alpha")


@pytest.fixture
def branch_b():
    return make_branch("BBB", name="Beta")


@pytest.fixture
def staff(branch_a, branch_b):
    return {
        "admin": client_for(make_staff("ADMIN")),
        "manager_a": client_for(make_staff("BRANCH_MANAGER", branches=[branch_a])),
        "manager_b": client_for(make_staff("BRANCH_MANAGER", branches=[branch_b])),
        "order_manager": client_for(make_staff("ORDER_MANAGER", branches=[branch_a, branch_b])),
        "support": client_for(make_staff("SUPPORT_AGENT", branches=[branch_a, branch_b])),
        "product": client_for(make_staff("PRODUCT_MANAGER")),
        "customer": client_for(make_user()),
        "anonymous": client_for(),
    }


def numbers(res):
    return [r["number"] for r in res.json()["results"]]


def age(order, minutes):
    """Pretend the order entered its current status `minutes` ago (placed_at + history entry)."""
    when = timezone.now() - timedelta(minutes=minutes)
    Order.objects.filter(pk=order.pk).update(placed_at=when)
    OrderStatusHistory.objects.filter(order=order).update(created_at=when)
    if order.status != "PENDING":
        OrderStatusHistory.objects.create(
            order=order, from_status="PENDING", to_status=order.status, actor_label="system"
        )
        OrderStatusHistory.objects.filter(order=order, to_status=order.status).update(created_at=when)


@pytest.mark.django_db
class TestAccessMatrix:
    @pytest.mark.parametrize(
        ("who", "expected"),
        [
            ("admin", 200),
            ("manager_a", 200),
            ("order_manager", 200),
            ("support", 200),
            ("product", 403),
            ("customer", 403),
            ("anonymous", 401),
        ],
    )
    def test_list_requires_orders_view(self, staff, who, expected):
        assert staff[who].get(LIST).status_code == expected

    @pytest.mark.parametrize(
        ("who", "expected"), [("admin", 200), ("support", 200), ("product", 403), ("customer", 403), ("anonymous", 401)]
    )
    def test_queue_requires_orders_view(self, staff, who, expected):
        assert staff[who].get(LIST + "queue/").status_code == expected

    def test_branch_scope_hides_other_branches(self, staff, branch_a, branch_b):
        a, b = make_order(branch=branch_a), make_order(branch=branch_b)
        assert numbers(staff["manager_a"].get(LIST)) == [a.number]
        assert numbers(staff["manager_b"].get(LIST)) == [b.number]
        assert sorted(numbers(staff["admin"].get(LIST))) == sorted([a.number, b.number])
        assert staff["manager_a"].get(f"{LIST}{b.number}/").status_code == 404
        assert staff["manager_a"].get(f"{LIST}{a.number}/").status_code == 200

    def test_unknown_order_is_404(self, staff):
        assert staff["admin"].get(f"{LIST}NOPE-1/").status_code == 404


@pytest.mark.django_db
class TestList:
    def test_row_payload_is_small_and_complete(self, staff, branch_a):
        o = make_order(branch=branch_a, items=[("Flat white", "4.00", 2), ("Beans", "12.00", 1)], payment_method="cash")
        row = staff["admin"].get(LIST).json()["results"][0]
        assert set(row) == {
            "number",
            "placed_at",
            "customer_name",
            "branch",
            "order_type",
            "status",
            "payment_status",
            "payment_method",
            "total",
            "currency",
            "item_count",
            "age_minutes",
            "minutes_in_status",
            "is_stuck",
            "needs_attention",
            "requested_for",
            "is_demo",
        }
        assert row["number"] == o.number and row["item_count"] == 3 and row["total"] == "20.00"
        assert (
            row["branch"] == {"id": branch_a.pk, "name": "Alpha"}
            and row["is_stuck"] is False
            and row["needs_attention"] is None
        )

    def test_status_filter_accepts_repeats_and_commas_and_rejects_garbage(self, staff, branch_a):
        p = make_order(branch=branch_a)
        c = make_order(branch=branch_a, status="CONFIRMED")
        make_order(branch=branch_a, status="COMPLETED")
        assert numbers(staff["admin"].get(LIST, {"status": "PENDING"})) == [p.number]
        assert sorted(numbers(staff["admin"].get(LIST + "?status=PENDING&status=CONFIRMED"))) == sorted(
            [p.number, c.number]
        )
        assert sorted(numbers(staff["admin"].get(LIST, {"status": "pending,confirmed"}))) == sorted(
            [p.number, c.number]
        )
        res = staff["admin"].get(LIST, {"status": "BOGUS"})
        assert res.status_code == 400 and res.json()["error"]["code"] == "validation_error"

    def test_payment_branch_type_method_filters(self, staff, branch_a, branch_b):
        paid = make_order(branch=branch_a, payment_status="PAID", payment_method="stripe")
        cash = make_order(branch=branch_b, order_type="DELIVERY", payment_method="cash")
        assert numbers(staff["admin"].get(LIST, {"payment_status": "PAID"})) == [paid.number]
        assert numbers(staff["admin"].get(LIST, {"branch": branch_b.pk})) == [cash.number]
        assert numbers(staff["admin"].get(LIST, {"order_type": "DELIVERY"})) == [cash.number]
        assert numbers(staff["admin"].get(LIST, {"payment_method": "stripe"})) == [paid.number]
        # a manager cannot widen their scope by asking for another branch
        assert numbers(staff["manager_a"].get(LIST, {"branch": branch_b.pk})) == []

    def test_search_number_prefix_contains_and_customer_fields(self, staff, branch_a):
        alice = make_user("alice.smith@example.com", first_name="Alice", last_name="Smith")
        a = make_order(alice, branch_a, customer_phone="+15557770001")
        b = make_order(make_user("bob@example.com", first_name="Bob", last_name="Jones"), branch_a)
        s = staff["admin"]
        assert numbers(s.get(LIST, {"q": a.number[:8]})) and a.number in numbers(s.get(LIST, {"q": a.number[:8]}))
        assert numbers(s.get(LIST, {"q": a.number[-4:]})) == [a.number]
        assert numbers(s.get(LIST, {"q": "alice.smith"})) == [a.number]
        assert numbers(s.get(LIST, {"q": "jones"})) == [b.number]
        assert numbers(s.get(LIST, {"q": "5557770001"})) == [a.number]
        assert numbers(s.get(LIST, {"q": "zzz-nothing"})) == []

    def test_dates_are_interpreted_in_each_branchs_time_zone(self, staff):
        utc_branch = make_branch("UTC1", timezone="UTC")
        nz_branch = make_branch("NZ1", timezone="Pacific/Auckland")  # UTC+13 in March
        moment = datetime(2026, 3, 10, 23, 30, tzinfo=UTC)  # = 12:30 on 11 March in Auckland
        in_utc, in_nz = make_order(branch=utc_branch), make_order(branch=nz_branch)
        Order.objects.filter(pk__in=[in_utc.pk, in_nz.pk]).update(placed_at=moment)
        s = staff["admin"]
        assert numbers(s.get(LIST, {"date_from": "2026-03-11"})) == [in_nz.number]
        assert numbers(s.get(LIST, {"date_to": "2026-03-10"})) == [in_utc.number]
        assert sorted(numbers(s.get(LIST, {"date_from": "2026-03-10", "date_to": "2026-03-11"}))) == sorted(
            [in_utc.number, in_nz.number]
        )
        assert numbers(s.get(LIST, {"date_from": "2026-03-12"})) == []
        assert s.get(LIST, {"date_from": "not-a-date"}).status_code == 400

    def test_ordering_and_pagination(self, staff, branch_a):
        small = make_order(branch=branch_a, items=[("A", "1.00", 1)])
        big = make_order(branch=branch_a, items=[("B", "50.00", 1)])
        mid = make_order(branch=branch_a, items=[("C", "9.00", 1)])
        assert numbers(staff["admin"].get(LIST, {"ordering": "total"})) == [small.number, mid.number, big.number]
        assert numbers(staff["admin"].get(LIST, {"ordering": "-total"})) == [big.number, mid.number, small.number]
        page = staff["admin"].get(LIST, {"ordering": "total", "page_size": 2}).json()
        assert page["count"] == 3 and len(page["results"]) == 2 and page["next"]

    def test_query_count_does_not_grow_with_rows(self, staff, branch_a, django_assert_max_num_queries):
        for _ in range(12):
            make_order(branch=branch_a)
        with django_assert_max_num_queries(10):
            assert staff["admin"].get(LIST, {"page_size": 12}).status_code == 200


@pytest.mark.django_db
class TestStuckDetection:
    def test_each_documented_rule(self, staff, branch_a):
        unpaid_old = make_order(branch=branch_a, payment_method="stripe", payment_status="REQUIRES_ACTION")
        age(unpaid_old, 40)
        unpaid_new = make_order(branch=branch_a, payment_method="stripe", payment_status="REQUIRES_ACTION")
        age(unpaid_new, 10)
        cash_old = make_order(branch=branch_a, payment_method="cash")
        age(cash_old, 300)

        paid_waiting = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID")
        make_payment(paid_waiting, "stripe", "PAID").__class__.objects.filter(order=paid_waiting).update(
            paid_at=timezone.now() - timedelta(minutes=20)
        )
        age(paid_waiting, 25)
        paid_fresh = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID")
        make_payment(paid_fresh, "stripe", "PAID")

        confirmed_old = make_order(branch=branch_a, status="CONFIRMED", payment_method="cash")
        age(confirmed_old, 25)
        confirmed_new = make_order(branch=branch_a, status="CONFIRMED", payment_method="cash")
        age(confirmed_new, 5)
        preparing_old = make_order(branch=branch_a, status="PREPARING", payment_method="cash")
        age(preparing_old, 50)
        preparing_new = make_order(branch=branch_a, status="PREPARING", payment_method="cash")
        age(preparing_new, 30)
        ready_old = make_order(branch=branch_a, status="READY_FOR_PICKUP", payment_method="cash")
        age(ready_old, 500)

        stuck = {unpaid_old.number, paid_waiting.number, confirmed_old.number, preparing_old.number}
        res = staff["admin"].get(LIST, {"stuck": "true", "page_size": 50})
        assert set(numbers(res)) == stuck
        assert all(r["is_stuck"] and r["needs_attention"] for r in res.json()["results"])
        rest = set(numbers(staff["admin"].get(LIST, {"stuck": "false", "page_size": 50})))
        assert rest == {
            unpaid_new.number,
            cash_old.number,
            paid_fresh.number,
            confirmed_new.number,
            preparing_new.number,
            ready_old.number,
        }
        reasons = {r["number"]: r["needs_attention"]["code"] for r in res.json()["results"]}
        assert (
            reasons[unpaid_old.number] == "payment_not_completed"
            and reasons[paid_waiting.number] == "paid_not_accepted"
        )
        assert (
            reasons[confirmed_old.number] == "confirmed_too_long"
            and reasons[preparing_old.number] == "preparing_too_long"
        )

    def test_cancelled_paid_order_needs_attention_but_is_not_stuck(self, staff, branch_a):
        o = make_order(branch=branch_a, status="CANCELLED", payment_status="PAID", payment_method="stripe")
        row = staff["admin"].get(LIST).json()["results"][0]
        assert (
            row["number"] == o.number and row["is_stuck"] is False and row["needs_attention"]["code"] == "refund_needed"
        )


@pytest.mark.django_db
class TestQueue:
    def test_counts_and_oldest_ages_per_status_for_scope(self, staff, branch_a, branch_b):
        p1 = make_order(branch=branch_a, payment_method="cash")
        age(p1, 12)
        p2 = make_order(branch=branch_a, payment_method="cash")
        age(p2, 3)
        c = make_order(branch=branch_a, status="CONFIRMED", payment_method="cash")
        age(c, 25)
        make_order(branch=branch_a, status="COMPLETED")
        make_order(branch=branch_a, status="CANCELLED")
        other = make_order(branch=branch_b, status="PREPARING", payment_method="cash")
        age(other, 60)

        body = staff["manager_a"].get(LIST + "queue/").json()
        by = {r["status"]: r for r in body["statuses"]}
        assert [r["status"] for r in body["statuses"]] == [
            "PENDING",
            "CONFIRMED",
            "PREPARING",
            "READY_FOR_PICKUP",
            "OUT_FOR_DELIVERY",
        ]
        assert by["PENDING"]["count"] == 2 and by["PENDING"]["oldest_age_minutes"] in (12, 13)
        assert by["CONFIRMED"]["count"] == 1 and by["CONFIRMED"]["stuck_count"] == 1
        assert by["PREPARING"]["count"] == 0 and by["PREPARING"]["oldest_age_minutes"] is None
        assert body["totals"] == {"active": 3, "stuck": 1} and body["branch_ids"] == [branch_a.pk]
        assert body["stuck_rules_minutes"]["preparing"] == 45

        admin = staff["admin"].get(LIST + "queue/").json()
        assert admin["branch_ids"] is None and admin["totals"]["active"] == 4
        only_b = staff["admin"].get(LIST + "queue/", {"branch": branch_b.pk}).json()
        assert only_b["totals"]["active"] == 1 and only_b["totals"]["stuck"] == 1

    def test_is_a_constant_number_of_queries(self, staff, branch_a, django_assert_max_num_queries):
        for st in ("PENDING", "CONFIRMED", "PREPARING", "PENDING"):
            make_order(branch=branch_a, status=st)
        with django_assert_max_num_queries(8):
            staff["admin"].get(LIST + "queue/")

    def test_bad_branch_param(self, staff):
        assert staff["admin"].get(LIST + "queue/", {"branch": "abc"}).status_code == 400


@pytest.mark.django_db
class TestDetail:
    def test_full_payload(self, staff, branch_a):
        o = make_order(
            branch=branch_a,
            order_type="DELIVERY",
            payment_method="stripe",
            payment_status="PAID",
            items=[("Latte", "4.00", 2, [("Milk", "Oat", "0.50")])],
            customer_notes="Ring twice",
            tax="0.50",
        )
        payment = settle(o, "stripe", reference="cs_x")
        make_refund(payment, "1.00")
        OrderNote.objects.create(order=o, author=make_staff("ADMIN"), body="VIP customer")
        body = staff["admin"].get(f"{LIST}{o.number}/").json()
        assert body["number"] == o.number and body["customer"]["email"] == o.customer_email
        assert body["items"][0]["options"] == [{"group_name": "Milk", "option_name": "Oat", "price_delta": "0.50"}]
        assert body["totals"]["delivery_fee"] == "2.00" and body["totals"]["total"] == o.total.__str__()
        assert body["delivery_address"]["line1"] == "5 Road" and body["customer_notes"] == "Ring twice"
        assert body["payments"][0]["id"] == payment.pk and body["payments"][0]["refunds"][0]["amount"] == "1.00"
        assert body["payments"][0]["order"]["number"] == o.number and body["payments"][0]["events"] == []
        assert body["notes"][0]["body"] == "VIP customer" and body["history"][0]["to_status"] == "PENDING"
        assert body["allowed_transitions"] == ["CONFIRMED", "CANCELLED"]

    def test_permission_flags_per_role(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        flags = {
            who: staff[who].get(f"{LIST}{o.number}/").json()["permissions"] for who in ("admin", "manager_a", "support")
        }
        assert flags["admin"] == {
            "can_transition": True,
            "can_cancel": True,
            "can_note": True,
            "can_refund": False,
            "can_collect_cash": True,
        }
        assert flags["manager_a"] == flags["admin"]
        assert flags["support"] == {
            "can_transition": False,
            "can_cancel": False,
            "can_note": True,
            "can_refund": False,
            "can_collect_cash": False,
        }

    def test_refund_flag_needs_a_refundable_payment(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID")
        settle(o, "stripe")
        assert staff["admin"].get(f"{LIST}{o.number}/").json()["permissions"]["can_refund"] is True
        assert (
            staff["manager_a"].get(f"{LIST}{o.number}/").json()["permissions"]["can_refund"] is False
        )  # no payments.refund

    def test_terminal_orders_offer_no_actions(self, staff, branch_a):
        o = make_order(branch=branch_a, status="COMPLETED", payment_method="cash")
        body = staff["admin"].get(f"{LIST}{o.number}/").json()
        assert (
            body["allowed_transitions"] == []
            and body["permissions"]["can_transition"] is False
            and body["permissions"]["can_cancel"] is False
        )

    def test_query_count_is_bounded(self, staff, branch_a, django_assert_max_num_queries):
        o = make_order(
            branch=branch_a, items=[("A", "1.00", 1), ("B", "2.00", 1), ("C", "3.00", 1)], payment_method="stripe"
        )
        settle(o, "stripe")
        with django_assert_max_num_queries(25):
            assert staff["admin"].get(f"{LIST}{o.number}/").status_code == 200


@pytest.mark.django_db
class TestTransition:
    def url(self, o):
        return f"{LIST}{o.number}/transition/"

    def test_manager_advances_order_with_audit_and_history(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        res = staff["manager_a"].post(self.url(o), {"to_status": "CONFIRMED", "note": "Ok"})
        assert res.status_code == 200 and res.json()["status"] == "CONFIRMED"
        assert res.json()["allowed_transitions"] == ["PREPARING", "CANCELLED"]
        assert [h["to_status"] for h in res.json()["history"]][-1] == "CONFIRMED"
        entry = AuditLog.objects.get(action="order.transition", resource_id=str(o.pk))
        assert entry.changes["to"] == "CONFIRMED" and entry.actor.email.startswith("branch_manager")

    def test_full_pickup_flow(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        for st in ("CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "COMPLETED"):
            assert staff["order_manager"].post(self.url(o), {"to_status": st}).json()["status"] == st
        o.refresh_from_db()
        assert o.completed_at is not None

    def test_invalid_transition_is_409_and_lists_allowed(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        res = staff["admin"].post(self.url(o), {"to_status": "READY_FOR_PICKUP"})
        err = res.json()["error"]
        assert res.status_code == 409 and err["code"] == "invalid_transition"
        assert "Allowed next steps: CONFIRMED, CANCELLED" in err["message"] and err["allowed"] == [
            "CONFIRMED",
            "CANCELLED",
        ]
        o.refresh_from_db()
        assert o.status == "PENDING"

    def test_delivery_only_status_is_invalid_for_pickup(self, staff, branch_a):
        o = make_order(branch=branch_a, status="PREPARING", payment_method="cash")
        assert staff["admin"].post(self.url(o), {"to_status": "OUT_FOR_DELIVERY"}).status_code == 409

    def test_repeat_is_idempotent(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        staff["admin"].post(self.url(o), {"to_status": "CONFIRMED"})
        res = staff["admin"].post(self.url(o), {"to_status": "CONFIRMED"})
        assert res.status_code == 200 and res.json()["status"] == "CONFIRMED"
        assert OrderStatusHistory.objects.filter(order=o, to_status="CONFIRMED").count() == 1
        assert AuditLog.objects.filter(action="order.transition", resource_id=str(o.pk)).count() == 1

    def test_unpaid_online_order_cannot_be_confirmed(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="REQUIRES_ACTION")
        res = staff["admin"].post(self.url(o), {"to_status": "CONFIRMED"})
        assert res.status_code == 409 and res.json()["error"]["code"] == "payment_required"

    def test_support_agent_cannot_transition(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        res = staff["support"].post(self.url(o), {"to_status": "CONFIRMED"})
        assert res.status_code == 403
        o.refresh_from_db()
        assert o.status == "PENDING"

    def test_other_branch_is_404_and_customers_are_403(self, staff, branch_b):
        o = make_order(branch=branch_b, payment_method="cash")
        assert staff["manager_a"].post(self.url(o), {"to_status": "CONFIRMED"}).status_code == 404
        assert staff["customer"].post(self.url(o), {"to_status": "CONFIRMED"}).status_code == 403
        assert staff["anonymous"].post(self.url(o), {"to_status": "CONFIRMED"}).status_code == 401
        o.refresh_from_db()
        assert o.status == "PENDING"

    def test_unknown_status_is_400(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        assert staff["admin"].post(self.url(o), {"to_status": "TELEPORTED"}).status_code == 400
        assert staff["admin"].post(self.url(o), {}).status_code == 400

    def test_cancel_through_transition_needs_reason_and_cancel_capability(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        assert staff["admin"].post(self.url(o), {"to_status": "CANCELLED"}).status_code == 400
        res = staff["admin"].post(self.url(o), {"to_status": "CANCELLED", "note": "Out of beans"})
        assert (
            res.status_code == 200
            and res.json()["status"] == "CANCELLED"
            and res.json()["cancel_reason"] == "Out of beans"
        )

    def test_notification_is_sent_to_the_customer(self, staff, branch_a, django_capture_on_commit_callbacks):
        o = make_order(branch=branch_a, payment_method="cash")
        with django_capture_on_commit_callbacks(execute=True):
            staff["admin"].post(self.url(o), {"to_status": "CONFIRMED"})
        from apps.notifications.models import Notification

        assert Notification.objects.filter(order=o, kind="order_confirmed", user=o.customer).count() == 1


@pytest.mark.django_db
class TestCancel:
    def url(self, o):
        return f"{LIST}{o.number}/cancel/"

    def test_cancel_without_refund_reports_not_requested(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID")
        payment = settle(o, "stripe")
        res = staff["admin"].post(self.url(o), {"reason": "Kitchen closed"})
        body = res.json()
        assert (
            res.status_code == 200
            and body["order"]["status"] == "CANCELLED"
            and body["refund"]["status"] == "NOT_REQUESTED"
        )
        payment.refresh_from_db()
        assert payment.status == "PAID"  # cancelling never flips payment status by itself
        assert body["order"]["needs_attention"]["code"] == "refund_needed"
        assert AuditLog.objects.filter(action="order.cancel", resource_id=str(o.pk)).count() == 1

    def test_reason_is_required(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        assert staff["admin"].post(self.url(o), {}).status_code == 400
        assert staff["admin"].post(self.url(o), {"reason": "   "}).status_code == 400

    def test_refund_without_a_settled_payment_is_not_applicable(
        self, staff, branch_a, django_capture_on_commit_callbacks
    ):
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="REQUIRES_ACTION")
        make_payment(o, "stripe", "REQUIRES_ACTION")
        with django_capture_on_commit_callbacks(execute=True):
            body = staff["admin"].post(self.url(o), {"reason": "x", "refund": True}).json()
        assert body["order"]["status"] == "CANCELLED" and body["refund"]["status"] == "NOT_APPLICABLE"
        assert (
            Payment.objects.get(order=o).status == "CANCELLED"
        )  # the open attempt is closed so it cannot be paid late

    def test_cash_refund_is_a_manual_hand_back(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash", payment_status="PAID")
        settle(o, "cash")
        body = staff["admin"].post(self.url(o), {"reason": "Customer left", "refund": True}).json()
        assert body["refund"]["status"] == "SUCCEEDED" and "manual cash hand-back" in body["refund"]["message"]
        assert body["order"]["totals"]["refunded_total"] == str(o.total)

    def test_cancel_with_provider_refund_reports_real_success(self, staff, branch_a, monkeypatch):
        import stripe

        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: {"id": "re_ok", "status": "succeeded"})
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID", items=[("Beans", "20.00", 1)])
        payment = settle(o, "stripe", provider_charge_id="pi_1")
        body = staff["admin"].post(self.url(o), {"reason": "Out of stock", "refund": True}).json()
        assert (
            body["refund"]["status"] == "SUCCEEDED"
            and body["refund"]["amount"] == "20.00"
            and body["refund"]["payment_id"] == payment.pk
        )
        assert body["order"]["payment_status"] == "REFUNDED" and body["order"]["needs_attention"] is None
        payment.refresh_from_db()
        assert payment.status == "REFUNDED"

    def test_refund_failure_is_reported_but_cancellation_stands_and_can_be_retried(self, staff, branch_a, monkeypatch):
        import stripe

        def down(**kw):
            raise stripe.APIConnectionError("nope")

        monkeypatch.setattr(stripe.Refund, "create", down)
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID", items=[("Beans", "20.00", 1)])
        payment = settle(o, "stripe", provider_charge_id="pi_1")
        res = staff["admin"].post(self.url(o), {"reason": "Out of stock", "refund": True})
        body = res.json()
        assert res.status_code == 200
        assert body["order"]["status"] == "CANCELLED" and body["refund"]["status"] == "FAILED"
        assert "could not reach" in body["refund"]["message"].lower() and "Retry" in body["refund"]["message"]
        assert body["order"]["payment_status"] == "PAID" and body["order"]["needs_attention"]["code"] == "refund_needed"
        payment.refresh_from_db()
        assert payment.status == "PAID" and payment.refunded_total == 0

        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: {"id": "re_2", "status": "succeeded"})
        again = staff["admin"].post(self.url(o), {"reason": "Out of stock", "refund": True}).json()
        assert again["order"]["status"] == "CANCELLED" and again["refund"]["status"] == "SUCCEEDED"

    def test_pending_refund_is_reported_as_pending(self, staff, branch_a, monkeypatch):
        import stripe

        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: {"id": "re_p", "status": "pending"})
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID")
        settle(o, "stripe", provider_charge_id="pi_1")
        assert staff["admin"].post(self.url(o), {"reason": "x", "refund": True}).json()["refund"]["status"] == "PENDING"

    def test_already_refunded_payment(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="REFUNDED", status="CANCELLED")
        payment = settle(o, "stripe")
        make_refund(payment, str(payment.amount))
        Payment.objects.filter(pk=payment.pk).update(status="REFUNDED", refunded_total=payment.amount)
        body = staff["admin"].post(self.url(o), {"reason": "x", "refund": True}).json()
        assert body["refund"]["status"] == "ALREADY_REFUNDED"

    def test_branch_manager_cannot_refund_and_nothing_happens(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="stripe", payment_status="PAID")
        settle(o, "stripe")
        res = staff["manager_a"].post(self.url(o), {"reason": "x", "refund": True})
        assert res.status_code == 403
        o.refresh_from_db()
        assert o.status == "PENDING"  # the request is refused as a whole
        assert staff["manager_a"].post(self.url(o), {"reason": "x"}).status_code == 200  # plain cancel is allowed

    def test_support_customer_and_other_branch_are_blocked(self, staff, branch_a, branch_b):
        o = make_order(branch=branch_a, payment_method="cash")
        assert staff["support"].post(self.url(o), {"reason": "x"}).status_code == 403
        assert staff["customer"].post(self.url(o), {"reason": "x"}).status_code == 403
        assert staff["manager_b"].post(self.url(o), {"reason": "x"}).status_code == 404
        o.refresh_from_db()
        assert o.status == "PENDING"

    def test_completed_orders_cannot_be_cancelled(self, staff, branch_a):
        o = make_order(branch=branch_a, status="COMPLETED", payment_method="cash")
        res = staff["admin"].post(self.url(o), {"reason": "x"})
        assert res.status_code == 409 and res.json()["error"]["code"] == "invalid_transition"

    def test_repeat_cancel_is_idempotent(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash")
        assert staff["admin"].post(self.url(o), {"reason": "x"}).status_code == 200
        assert staff["admin"].post(self.url(o), {"reason": "x"}).status_code == 200
        assert OrderStatusHistory.objects.filter(order=o, to_status="CANCELLED").count() == 1


@pytest.mark.django_db
class TestNotes:
    def url(self, o):
        return f"{LIST}{o.number}/notes/"

    def test_staff_can_note_and_it_is_internal_only(self, staff, branch_a):
        o = make_order(branch=branch_a)
        res = staff["support"].post(self.url(o), {"body": "Customer called, wants oat milk"})
        assert res.status_code == 201 and res.json()["body"].startswith("Customer called")
        assert OrderNote.objects.filter(order=o).count() == 1
        detail = staff["admin"].get(f"{LIST}{o.number}/").json()
        assert detail["notes"][0]["body"] == "Customer called, wants oat milk"
        # the customer's own view of the order never carries internal notes
        customer = client_for(o.customer)
        mine = customer.get(f"/api/v1/orders/{o.number}/")
        assert mine.status_code == 200 and "oat milk" not in mine.content.decode()

    def test_validation_and_authorization(self, staff, branch_b):
        o = make_order(branch=branch_b)
        assert staff["admin"].post(self.url(o), {"body": ""}).status_code == 400
        assert staff["product"].post(self.url(o), {"body": "x"}).status_code == 403
        assert staff["customer"].post(self.url(o), {"body": "x"}).status_code == 403
        assert staff["manager_a"].post(self.url(o), {"body": "x"}).status_code == 404
        assert OrderNote.objects.count() == 0


@pytest.mark.django_db
class TestCollectCash:
    def url(self, o):
        return f"{LIST}{o.number}/collect-cash/"

    def test_manager_collects_cash_idempotently(self, staff, branch_a):
        o = make_order(branch=branch_a, payment_method="cash", status="CONFIRMED")
        make_payment(o, "cash")
        res = staff["manager_a"].post(self.url(o))
        assert res.status_code == 200 and res.json()["payment_status"] == "PAID"
        assert res.json()["payments"][0]["status"] == "PAID" and res.json()["permissions"]["can_collect_cash"] is False
        assert staff["manager_a"].post(self.url(o)).status_code == 200
        assert Payment.objects.filter(order=o).count() == 1
        assert AuditLog.objects.filter(action="payment.cash_collected").count() == 1

    def test_blocked_for_support_other_branches_customers_and_wrong_method(self, staff, branch_a, branch_b):
        cash = make_order(branch=branch_a, payment_method="cash")
        assert staff["support"].post(self.url(cash)).status_code == 403
        assert staff["customer"].post(self.url(cash)).status_code == 403
        assert staff["manager_b"].post(self.url(cash)).status_code == 404
        online = make_order(branch=branch_a, payment_method="stripe")
        res = staff["admin"].post(self.url(online))
        assert res.status_code == 409 and res.json()["error"]["code"] == "not_cash_order"
        assert not Payment.objects.filter(status="PAID").exists()
