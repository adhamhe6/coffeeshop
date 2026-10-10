"""End-to-end flows across checkout (C1), payments, admin orders and notifications, through the public API only."""

import pytest
import stripe
from django.core import mail

from apps.cart.tests.fixtures import add_to_cart, client_for, do_checkout
from apps.core.testing import client_for as staff_client
from apps.notifications.models import Notification
from apps.payments.models import Payment
from tests.factories import make_staff, make_user

from .helpers import post_stripe_webhook, session_object, stripe_event

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(shop):
    return staff_client(make_staff("BRANCH_MANAGER", branches=[shop.branch]))


@pytest.fixture
def admin():
    return staff_client(make_staff("ADMIN"))


def reference_of(action):
    return action["url"].rsplit("/", 1)[1]


def test_sandbox_purchase_decline_retry_pay_and_fulfil(auth, shop, manager, django_capture_on_commit_callbacks):
    add_to_cart(auth, shop.beans, quantity=2)
    with django_capture_on_commit_callbacks(execute=True):
        placed = do_checkout(auth, shop, payment_method="demo")
    assert placed.status_code == 201
    number = placed.data["order"]["number"]
    pay = placed.data["payment"]
    assert pay["is_sandbox"] is True and pay["action"]["type"] == "redirect"

    page = auth.get(f"/api/v1/payments/demo/{reference_of(pay['action'])}/").json()
    assert page["order_number"] == number and page["total"] == "25.00" and page["sandbox"] is True

    declined = auth.post(f"/api/v1/payments/demo/{page['reference']}/complete/", {"outcome": "decline"}).json()
    assert declined["order_payment_status"] == "FAILED" and declined["can_retry"] is True
    order = auth.get(f"/api/v1/orders/{number}/").json()
    assert order["status"] == "PENDING" and order["payment_status"] == "FAILED"
    assert order["payment"]["failure_message"]

    retry = auth.post(f"/api/v1/orders/{number}/pay/", {}, format="json").json()
    assert retry["action"]["type"] == "redirect" and reference_of(retry["action"]) != page["reference"]
    with django_capture_on_commit_callbacks(execute=True):
        done = auth.post(
            f"/api/v1/payments/demo/{reference_of(retry['action'])}/complete/", {"outcome": "success"}
        ).json()
    assert done["order_payment_status"] == "PAID"

    # staff: confirm (online order is now confirmable), prepare, ready, complete
    for status in ("CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "COMPLETED"):
        with django_capture_on_commit_callbacks(execute=True):
            res = manager.post(f"/api/v1/admin/orders/{number}/transition/", {"to_status": status})
        assert res.status_code == 200, res.json()
    detail = manager.get(f"/api/v1/admin/orders/{number}/").json()
    assert detail["status"] == "COMPLETED" and [p["status"] for p in detail["payments"]] == ["PAID", "FAILED"]
    assert [e["outcome"] for p in detail["payments"] for e in p["events"]] == ["applied", "applied"]

    kinds = list(auth.get("/api/v1/notifications/").json()["results"])
    assert sorted(n["kind"] for n in kinds) == sorted(
        [
            "order_placed",
            "payment_failed",
            "payment_confirmed",
            "order_confirmed",
            "order_preparing",
            "order_ready",
            "order_completed",
        ]
    )
    assert Payment.objects.filter(order__number=number, status="PAID").count() == 1
    assert {m.subject for m in mail.outbox} >= {f"Order {number} confirmed", f"Payment received for order {number}"}


def test_card_purchase_via_signed_webhook_then_staff_refund(
    auth, shop, admin, monkeypatch, django_capture_on_commit_callbacks
):
    monkeypatch.setattr(
        stripe.checkout.Session, "create", lambda **p: {"id": "cs_e2e", "url": "https://checkout.stripe.test/cs_e2e"}
    )
    add_to_cart(auth, shop.beans, quantity=1)
    placed = do_checkout(auth, shop, payment_method="stripe")
    assert placed.status_code == 201
    number = placed.data["order"]["number"]
    assert placed.data["payment"]["action"]["url"] == "https://checkout.stripe.test/cs_e2e"

    attempt = Payment.objects.get(order__number=number)
    # the browser returning to the site proves nothing: before the provider says so, the order is unpaid
    assert auth.get(f"/api/v1/orders/{number}/").json()["payment_status"] == "REQUIRES_ACTION"
    monkeypatch.setattr(
        stripe.checkout.Session,
        "retrieve",
        lambda sid, **kw: stripe.checkout.Session.construct_from(
            session_object(attempt, payment_status="unpaid", status="open"), "k"
        ),
    )
    assert auth.post(f"/api/v1/orders/{number}/payment/sync/").json()["payment"]["status"] == "REQUIRES_ACTION"

    with django_capture_on_commit_callbacks(execute=True):
        res = post_stripe_webhook(auth, stripe_event("checkout.session.completed", session_object(attempt)))
    assert res.status_code == 200
    assert auth.get(f"/api/v1/orders/{number}/").json()["payment_status"] == "PAID"

    # staff cancel with refund -> real provider call, real outcome reported
    monkeypatch.setattr(stripe.Refund, "create", lambda **kw: {"id": "re_e2e", "status": "succeeded"})
    with django_capture_on_commit_callbacks(execute=True):
        out = admin.post(f"/api/v1/admin/orders/{number}/cancel/", {"reason": "Roaster down", "refund": True}).json()
    assert out["order"]["status"] == "CANCELLED" and out["refund"]["status"] == "SUCCEEDED"
    assert out["order"]["payment_status"] == "REFUNDED"
    mine = auth.get(f"/api/v1/orders/{number}/").json()
    assert mine["status"] == "CANCELLED" and mine["payment_status"] == "REFUNDED"
    assert Notification.objects.filter(order__number=number, kind="refund_updated").count() == 1


def test_cash_order_is_collected_by_staff(auth, shop, manager):
    add_to_cart(auth, shop.beans)
    number = do_checkout(auth, shop, payment_method="cash").data["order"]["number"]
    assert manager.post(f"/api/v1/admin/orders/{number}/transition/", {"to_status": "CONFIRMED"}).status_code == 200
    res = manager.post(f"/api/v1/admin/orders/{number}/collect-cash/")
    assert res.status_code == 200 and res.json()["payment_status"] == "PAID"
    assert auth.get(f"/api/v1/orders/{number}/").json()["payment_status"] == "PAID"
    assert Payment.objects.filter(order__number=number).count() == 1


def test_customers_cannot_reach_staff_or_foreign_payment_endpoints(auth, shop, customer):
    add_to_cart(auth, shop.beans)
    number = do_checkout(auth, shop, payment_method="demo").data["order"]["number"]
    intruder = client_for(make_user())
    ref = Payment.objects.get(order__number=number).reference
    assert intruder.get(f"/api/v1/payments/demo/{ref}/").status_code == 404
    assert intruder.post(f"/api/v1/payments/demo/{ref}/complete/", {"outcome": "success"}).status_code == 404
    assert intruder.post(f"/api/v1/orders/{number}/payment/sync/").status_code == 404
    assert auth.get(f"/api/v1/admin/orders/{number}/").status_code == 403
    assert auth.get("/api/v1/admin/payments/").status_code == 403
