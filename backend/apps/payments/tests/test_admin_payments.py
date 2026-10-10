import threading
from datetime import timedelta
from decimal import Decimal

import pytest
import stripe
from django.db import connection
from django.test import Client
from django.utils import timezone

from apps.core.models import AuditLog
from apps.core.testing import client_for
from apps.payments import services
from apps.payments.models import Payment, PaymentEvent, Refund
from tests.factories import make_branch, make_staff, make_user

from .helpers import demo_event, make_order, make_payment, make_refund, settle

LIST = "/api/v1/admin/payments/"


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
        "support": client_for(make_staff("SUPPORT_AGENT", branches=[branch_a, branch_b])),
        "order_manager": client_for(make_staff("ORDER_MANAGER", branches=[branch_a, branch_b])),
        "product": client_for(make_staff("PRODUCT_MANAGER")),
        "customer": client_for(make_user()),
        "anonymous": client_for(),
    }


def ids(res):
    return sorted(r["id"] for r in res.json()["results"])


@pytest.mark.django_db
class TestListAndDetail:
    @pytest.mark.parametrize(
        ("who", "code"),
        [
            ("admin", 200),
            ("manager_a", 200),
            ("support", 200),
            ("order_manager", 200),
            ("product", 403),
            ("customer", 403),
            ("anonymous", 401),
        ],
    )
    def test_capability_matrix(self, staff, who, code):
        assert staff[who].get(LIST).status_code == code

    def test_branch_scoping_on_list_and_detail(self, staff, branch_a, branch_b):
        pa = make_payment(make_order(branch=branch_a), "demo")
        pb = make_payment(make_order(branch=branch_b), "demo")
        assert ids(staff["manager_a"].get(LIST)) == [pa.pk]
        assert ids(staff["admin"].get(LIST)) == sorted([pa.pk, pb.pk])
        assert staff["manager_a"].get(f"{LIST}{pb.pk}/").status_code == 404
        assert staff["manager_a"].get(f"{LIST}{pa.pk}/").status_code == 200
        assert staff["admin"].get(f"{LIST}999999/").status_code == 404

    def test_detail_includes_events_refunds_and_order_summary(self, staff, branch_a):
        order = make_order(branch=branch_a, items=[("Beans", "10.00", 1)])
        payment = services.start_payment(
            order, "demo", return_url="https://a.test/", cancel_url="https://a.test/"
        ).payment
        services.handle_provider_event("demo", demo_event(payment, "success"))
        services.refund_payment(payment, "2.00", "Spilled", make_staff("ADMIN"))
        body = staff["admin"].get(f"{LIST}{payment.pk}/").json()
        assert body["status"] == "PARTIALLY_REFUNDED" and body["is_sandbox"] is True and body["provider_label"]
        assert body["order"]["number"] == order.number and body["order"]["branch_name"] == "Alpha"
        assert [e["outcome"] for e in body["events"]] == ["applied"] and body["events"][0][
            "event_type"
        ] == "demo.payment.succeeded"
        assert body["refunds"][0]["amount"] == "2.00" and body["refunds"][0]["reason"] == "Spilled"
        assert body["refundable_amount"] == "8.00" and body["can_refund"] is True
        assert staff["support"].get(f"{LIST}{payment.pk}/").json()["can_refund"] is False

    def test_filters(self, staff, branch_a, branch_b):
        demo = make_payment(
            make_order(branch=branch_a, payment_method="demo", payment_status="REQUIRES_ACTION"),
            "demo",
            "REQUIRES_ACTION",
        )
        failed = make_payment(
            make_order(branch=branch_a, payment_method="stripe"), "stripe", "FAILED", failure_message="Declined"
        )
        paid = settle(make_order(branch=branch_b, payment_method="stripe"), "stripe", sandbox=False)
        old = make_payment(make_order(branch=branch_b), "cash", "PENDING")
        Payment.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=10))
        s = staff["admin"]
        assert ids(s.get(LIST, {"provider": "stripe"})) == sorted([failed.pk, paid.pk])
        assert ids(s.get(LIST, {"status": "FAILED"})) == [failed.pk]
        assert ids(s.get(LIST + "?status=PAID&status=REQUIRES_ACTION")) == sorted([paid.pk, demo.pk])
        assert ids(s.get(LIST, {"is_sandbox": "true"})) == [demo.pk]
        assert ids(s.get(LIST, {"is_sandbox": "false"})) == sorted([failed.pk, paid.pk, old.pk])
        assert ids(s.get(LIST, {"branch": branch_b.pk})) == sorted([paid.pk, old.pk])
        assert ids(s.get(LIST, {"failed": "true"})) == [failed.pk]
        today = timezone.now().date().isoformat()
        assert old.pk not in ids(s.get(LIST, {"date_from": today}))
        assert ids(s.get(LIST, {"date_to": (timezone.now() - timedelta(days=5)).date().isoformat()})) == [old.pk]
        assert ids(s.get(LIST, {"q": paid.order.number})) == [paid.pk]
        assert ids(s.get(LIST, {"q": paid.order.customer_email})) == [paid.pk]
        assert ids(s.get(LIST, {"q": paid.reference})) == [paid.pk]

    def test_needs_refund_filter(self, staff, branch_a):
        cancelled_paid = settle(make_order(branch=branch_a, status="CANCELLED"))
        cancelled_partial = settle(make_order(branch=branch_a, status="CANCELLED"))
        Payment.objects.filter(pk=cancelled_partial.pk).update(
            status="PARTIALLY_REFUNDED", refunded_total=Decimal("1.00")
        )
        refunded_fully = settle(make_order(branch=branch_a, status="CANCELLED"))
        Payment.objects.filter(pk=refunded_fully.pk).update(status="REFUNDED", refunded_total=refunded_fully.amount)
        active_paid = settle(make_order(branch=branch_a, status="CONFIRMED"))
        cancelled_unpaid = make_payment(make_order(branch=branch_a, status="CANCELLED"), "demo", "CANCELLED")
        # a flagged duplicate charge also needs a refund
        order = make_order(branch=branch_a)
        settle(order)
        dup = make_payment(order, "demo", "REQUIRES_ACTION", reference="demo_dup")
        services.handle_provider_event("demo", demo_event(dup, "success"))
        rows = {r["id"]: r for r in staff["admin"].get(LIST, {"needs_refund": "true"}).json()["results"]}
        assert sorted(rows) == sorted([cancelled_paid.pk, cancelled_partial.pk, dup.pk])
        assert rows[dup.pk]["flagged_reason"] == "duplicate_charge" and rows[dup.pk]["needs_refund"] is True
        rest = ids(staff["admin"].get(LIST, {"needs_refund": "false", "page_size": 50}))
        assert refunded_fully.pk in rest and active_paid.pk in rest and cancelled_unpaid.pk in rest
        assert ids(staff["admin"].get(LIST, {"flagged": "true"})) == [dup.pk]

    def test_ordering(self, staff, branch_a):
        small = make_payment(make_order(branch=branch_a, items=[("A", "1.00", 1)]), "demo")
        big = make_payment(make_order(branch=branch_a, items=[("B", "9.00", 1)]), "demo")
        res = staff["admin"].get(LIST, {"ordering": "-amount"}).json()["results"]
        assert [r["id"] for r in res] == [big.pk, small.pk]

    def test_list_query_count_is_bounded(self, staff, branch_a, django_assert_max_num_queries):
        for _ in range(10):
            p = make_payment(make_order(branch=branch_a), "demo")
            settle(p.order)
            make_refund(p, "1.00")
        with django_assert_max_num_queries(7):
            assert staff["admin"].get(LIST, {"page_size": 10}).status_code == 200


@pytest.mark.django_db
class TestRefundEndpoint:
    def url(self, p):
        return f"{LIST}{p.pk}/refund/"

    def paid(self, branch, amount="20.00", provider="stripe"):
        order = make_order(branch=branch, payment_method=provider, items=[("Beans", amount, 1)])
        return settle(order, provider, provider_charge_id="pi_1")

    def ok_refund(self, monkeypatch, calls=None):
        def fake(**kw):
            if calls is not None:
                calls.append(kw)
            return {"id": f"re_{len(calls or [1])}", "status": "succeeded"}

        monkeypatch.setattr(stripe.Refund, "create", fake)

    def test_default_is_full_remaining_amount(self, staff, branch_a, monkeypatch):
        calls = []
        self.ok_refund(monkeypatch, calls)
        p = self.paid(branch_a)
        res = staff["admin"].post(self.url(p), {"reason": "Customer request"})
        body = res.json()
        assert (
            res.status_code == 200 and body["refund"]["status"] == "SUCCEEDED" and body["refund"]["amount"] == "20.00"
        )
        assert body["payment"]["status"] == "REFUNDED" and body["payment"]["order"]["payment_status"] == "REFUNDED"
        assert calls[0]["amount"] == 2000
        assert AuditLog.objects.filter(action="payment.refund", resource_id=str(p.pk)).count() == 1

    def test_partial_then_remaining(self, staff, branch_a, monkeypatch):
        self.ok_refund(monkeypatch, [])
        p = self.paid(branch_a)
        first = staff["admin"].post(self.url(p), {"amount": "5.50", "reason": "Cold"}).json()
        assert first["payment"]["status"] == "PARTIALLY_REFUNDED" and first["payment"]["refundable_amount"] == "14.50"
        second = staff["admin"].post(self.url(p), {"reason": "Rest"}).json()
        assert second["refund"]["amount"] == "14.50" and second["payment"]["status"] == "REFUNDED"
        nothing = staff["admin"].post(self.url(p), {"reason": "again"})
        assert nothing.status_code == 409 and nothing.json()["error"]["code"] == "nothing_to_refund"

    def test_over_refund_rejected(self, staff, branch_a, monkeypatch):
        monkeypatch.setattr(stripe.Refund, "create", lambda **kw: pytest.fail("provider must not be called"))
        p = self.paid(branch_a)
        res = staff["admin"].post(self.url(p), {"amount": "20.01", "reason": "x"})
        assert (
            res.status_code == 409
            and res.json()["error"]["code"] == "refund_exceeds_remaining"
            and res.json()["error"]["remaining"] == "20.00"
        )
        assert Refund.objects.count() == 0

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"reason": ""},
            {"reason": "x", "amount": "0"},
            {"reason": "x", "amount": "-3"},
            {"reason": "x", "amount": "abc"},
        ],
    )
    def test_validation(self, staff, branch_a, payload):
        p = self.paid(branch_a)
        res = staff["admin"].post(self.url(p), payload)
        assert res.status_code == 400 and res.json()["error"]["code"] == "validation_error"

    def test_unpaid_payment_is_409(self, staff, branch_a):
        p = make_payment(make_order(branch=branch_a), "demo", "REQUIRES_ACTION")
        res = staff["admin"].post(self.url(p), {"reason": "x"})
        assert res.status_code == 409 and res.json()["error"]["code"] in ("payment_not_refundable", "nothing_to_refund")

    def test_provider_failure_is_502_with_real_message_and_retry_works(self, staff, branch_a, monkeypatch):
        def down(**kw):
            raise stripe.APIConnectionError("sk_test_unit_tests_only is down")

        monkeypatch.setattr(stripe.Refund, "create", down)
        p = self.paid(branch_a)
        res = staff["admin"].post(self.url(p), {"reason": "x"})
        err = res.json()["error"]
        assert res.status_code == 502 and err["code"] == "refund_failed" and "sk_test" not in res.content.decode()
        assert err["refund"]["status"] == "FAILED"
        p.refresh_from_db()
        assert p.status == "PAID" and p.refunded_total == 0
        self.ok_refund(monkeypatch, [])
        retry = staff["admin"].post(self.url(p), {"reason": "x"})
        assert retry.status_code == 200 and retry.json()["payment"]["status"] == "REFUNDED"

    def test_idempotency_key_makes_retries_safe(self, staff, branch_a, monkeypatch):
        calls = []
        self.ok_refund(monkeypatch, calls)
        p = self.paid(branch_a)
        c = staff["admin"]
        a = c.post(self.url(p), {"amount": "5.00", "reason": "x"}, HTTP_IDEMPOTENCY_KEY="abc-123").json()
        b = c.post(self.url(p), {"amount": "5.00", "reason": "x"}, HTTP_IDEMPOTENCY_KEY="abc-123").json()
        assert a["refund"]["id"] == b["refund"]["id"] and len(calls) == 1
        assert Payment.objects.get(pk=p.pk).refunded_total == Decimal("5.00")
        assert c.post(self.url(p), {"reason": "x"}, HTTP_IDEMPOTENCY_KEY="k" * 65).status_code == 400

    def test_cash_payment_refund_is_manual(self, staff, branch_a):
        p = self.paid(branch_a, provider="cash")
        body = staff["admin"].post(self.url(p), {"reason": "Wrong order"}).json()
        assert body["refund"]["reference"] == "manual-cash" and body["payment"]["status"] == "REFUNDED"

    def test_authorization(self, staff, branch_a, branch_b):
        p = self.paid(branch_a)
        for who in ("manager_a", "support", "order_manager", "product", "customer"):
            assert staff[who].post(self.url(p), {"reason": "x"}).status_code == 403, who
        assert staff["anonymous"].post(self.url(p), {"reason": "x"}).status_code == 401
        other = client_for(make_staff("ADMIN"))  # global admin may refund anywhere; scope is covered below
        assert other.get(f"{LIST}{p.pk}/").status_code == 200
        assert Refund.objects.count() == 0

    def test_refund_respects_branch_scope(self, branch_a, branch_b, monkeypatch):
        self.ok_refund(monkeypatch, [])
        from apps.accounts import permissions as perms

        # No shipped branch-scoped role may refund, so grant the capability to one for this scope check only.

        monkeypatch.setitem(
            perms.ROLE_CAPABILITIES, "BRANCH_MANAGER", perms.ROLE_CAPABILITIES["BRANCH_MANAGER"] | {"payments.refund"}
        )
        manager = client_for(make_staff("BRANCH_MANAGER", branches=[branch_a]))
        mine, theirs = self.paid(branch_a), self.paid(branch_b)
        assert manager.post(self.url(theirs), {"reason": "x"}).status_code == 404
        assert manager.post(self.url(mine), {"reason": "x"}).status_code == 200


@pytest.mark.django_db(transaction=True)
class TestRefundEndpointConcurrency:
    def test_double_click_cannot_refund_twice(self, branch_a, monkeypatch):
        calls, lock = [], threading.Lock()

        def fake(**kw):
            with lock:
                calls.append(kw)
            return {"id": f"re_{len(calls)}", "status": "succeeded"}

        monkeypatch.setattr(stripe.Refund, "create", fake)
        order = make_order(branch=branch_a, payment_method="stripe", items=[("Beans", "30.00", 1)])
        payment = settle(order, "stripe", provider_charge_id="pi_1")
        admin = make_staff("ADMIN")
        codes = []
        barrier = threading.Barrier(4)

        def worker():
            try:
                client = Client()
                client.force_login(admin)
                barrier.wait()
                res = client.post(f"{LIST}{payment.pk}/refund/", {"reason": "x"}, content_type="application/json")
                codes.append(res.status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(4)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        payment.refresh_from_db()
        assert sorted(codes) == [200, 409, 409, 409]
        assert len(calls) == 1 and payment.refunded_total == Decimal("30.00") and payment.status == "REFUNDED"


@pytest.mark.django_db
def test_event_log_is_visible_to_staff_for_failed_amount_checks(staff, branch_a):
    order = make_order(branch=branch_a)
    p = services.start_payment(order, "demo", return_url="https://a.test/", cancel_url="https://a.test/").payment
    services.handle_provider_event("demo", demo_event(p, "success", amount=Decimal("0.01")))
    body = staff["support"].get(f"{LIST}{p.pk}/").json()
    assert (
        body["flagged_reason"] == "amount_mismatch"
        and body["events"][0]["outcome"] == "error"
        and "mismatch" in body["events"][0]["error"]
    )
    assert PaymentEvent.objects.count() == 1
