import json

import pytest
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.payments import services
from apps.payments.models import Payment, PaymentEvent
from apps.payments.providers import demo as demo_mod
from tests.factories import make_user

from .helpers import make_order

URLS = {"return_url": "https://shop.test/ok", "cancel_url": "https://shop.test/no"}


@pytest.fixture
def owner():
    return make_user()


@pytest.fixture
def attempt(owner):
    order = make_order(owner, payment_method="demo", items=[("Flat white", "4.00", 2), ("Beans", "12.00", 1)])
    return services.start_payment(order, "demo", **URLS).payment


def url(payment, suffix=""):
    return f"/api/v1/payments/demo/{payment.reference}/{suffix}"


@pytest.mark.django_db
class TestMethods:
    def test_public_list_flags_sandbox_and_offline(self, api):
        res = api.get("/api/v1/payments/methods/")
        assert res.status_code == 200
        by_key = {m["key"]: m for m in res.json()}
        assert set(by_key) == {"demo", "cash", "stripe"}
        assert by_key["demo"]["is_sandbox"] is True and "no real money" in by_key["demo"]["description"]
        assert by_key["cash"]["offline"] is True and by_key["cash"]["is_sandbox"] is False

    def test_demo_disappears_when_disabled(self, api, settings):
        settings.PAYMENT_DEMO_ENABLED = False
        assert "demo" not in {m["key"] for m in api.get("/api/v1/payments/methods/").json()}


@pytest.mark.django_db
class TestDemoDetail:
    def test_owner_sees_order_summary_flagged_sandbox(self, login, owner, attempt):
        res = login(owner).get(url(attempt))
        body = res.json()
        assert res.status_code == 200
        assert body["order_number"] == attempt.order.number and body["total"] == "20.00" and body["currency"] == "USD"
        assert body["sandbox"] is True and body["can_complete"] is True and "no real money" in body["notice"]
        assert [i["name"] for i in body["items"]] == ["Flat white", "Beans"]

    def test_other_customers_get_404_not_403(self, login, attempt):
        assert login(make_user()).get(url(attempt)).status_code == 404

    def test_anonymous_is_401(self, api, attempt):
        assert api.get(url(attempt)).status_code == 401

    def test_unknown_reference_404(self, login, owner):
        assert login(owner).get("/api/v1/payments/demo/demo_nope/").status_code == 404

    def test_everything_404s_when_demo_disabled(self, login, api, owner, attempt, settings):
        settings.PAYMENT_DEMO_ENABLED = False
        assert login(owner).get(url(attempt)).status_code == 404
        assert api.post(url(attempt, "complete/"), {"outcome": "success"}).status_code == 404
        assert APIClient().get(url(attempt)).status_code == 404  # even before authentication
        assert api.post("/api/v1/payments/webhooks/demo/", b"{}", content_type="application/json").status_code == 404
        attempt.refresh_from_db()
        assert attempt.status == "REQUIRES_ACTION"


@pytest.mark.django_db
class TestDemoComplete:
    def test_success_goes_through_the_event_pipeline(self, login, owner, attempt):
        res = login(owner).post(url(attempt, "complete/"), {"outcome": "success"})
        body = res.json()
        assert res.status_code == 200
        assert body["payment_status"] == "PAID" and body["order_payment_status"] == "PAID" and body["sandbox"] is True
        assert body["event_outcome"] == "applied" and body["can_retry"] is False
        event = PaymentEvent.objects.get()
        assert event.provider == "demo" and event.event_type == "demo.payment.succeeded" and event.outcome == "applied"
        assert Notification.objects.filter(order=attempt.order, kind="payment_confirmed").count() == 1

    def test_repeating_success_is_idempotent(self, login, owner, attempt):
        c = login(owner)
        c.post(url(attempt, "complete/"), {"outcome": "success"})
        res = c.post(url(attempt, "complete/"), {"outcome": "success"})
        assert res.status_code == 200 and res.json()["payment_status"] == "PAID"
        assert PaymentEvent.objects.count() == 1
        assert Notification.objects.filter(kind="payment_confirmed").count() == 1

    def test_decline_then_retry_succeeds_exactly_once(self, login, owner, attempt):
        c = login(owner)
        declined = c.post(url(attempt, "complete/"), {"outcome": "decline"}).json()
        assert (
            declined["payment_status"] == "FAILED"
            and declined["order_status"] == "PENDING"
            and declined["can_retry"] is True
        )
        # the failed attempt is closed to further input
        res = c.post(url(attempt, "complete/"), {"outcome": "success"})
        assert res.status_code == 409 and res.json()["error"]["code"] == "payment_not_pending"

        retry = services.start_payment(attempt.order, "demo", **URLS).payment
        assert retry.pk != attempt.pk
        ok = c.post(url(retry, "complete/"), {"outcome": "success"}).json()
        c.post(url(retry, "complete/"), {"outcome": "success"})
        assert ok["order_payment_status"] == "PAID"
        assert Payment.objects.filter(order=attempt.order, status="PAID").count() == 1
        assert sorted(Notification.objects.values_list("kind", flat=True)) == ["payment_confirmed", "payment_failed"]

    def test_cancel_outcome(self, login, owner, attempt):
        body = login(owner).post(url(attempt, "complete/"), {"outcome": "cancel"}).json()
        assert (
            body["payment_status"] == "CANCELLED"
            and body["order_payment_status"] == "PENDING"
            and body["can_retry"] is True
        )

    def test_conflicting_outcome_after_settlement_is_409(self, login, owner, attempt):
        c = login(owner)
        c.post(url(attempt, "complete/"), {"outcome": "success"})
        assert c.post(url(attempt, "complete/"), {"outcome": "decline"}).status_code == 409

    def test_invalid_outcome_is_400(self, login, owner, attempt):
        res = login(owner).post(url(attempt, "complete/"), {"outcome": "refund"})
        assert res.status_code == 400 and res.json()["error"]["code"] == "validation_error"

    def test_non_owner_cannot_complete(self, login, attempt):
        assert login(make_user()).post(url(attempt, "complete/"), {"outcome": "success"}).status_code == 404
        attempt.refresh_from_db()
        assert attempt.status == "REQUIRES_ACTION"

    def test_anonymous_cannot_complete(self, api, attempt):
        assert api.post(url(attempt, "complete/"), {"outcome": "success"}).status_code == 401


@pytest.mark.django_db
class TestDemoWebhook:
    def _post(self, api, payment, outcome="success", *, sign=True):
        body, headers = demo_mod.build_signed_event(payment, outcome)
        extra = {"HTTP_X_DEMO_SIGNATURE": headers[demo_mod.SIGNATURE_HEADER] if sign else "0" * 64}
        return api.generic("POST", "/api/v1/payments/webhooks/demo/", body, content_type="application/json", **extra)

    def test_externally_signed_event_is_applied(self, api, attempt):
        res = self._post(api, attempt)
        assert res.status_code == 200 and res.json() == {"received": True, "outcome": "applied"}
        attempt.refresh_from_db()
        assert attempt.status == "PAID"

    def test_invalid_signature_is_400_and_changes_nothing(self, api, attempt):
        res = self._post(api, attempt, sign=False)
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_signature"
        attempt.refresh_from_db()
        assert attempt.status == "REQUIRES_ACTION" and PaymentEvent.objects.count() == 0

    def test_replayed_delivery_is_a_noop(self, api, attempt):
        self._post(api, attempt)
        again = self._post(api, attempt)
        assert again.json()["outcome"] == "duplicate"
        assert Notification.objects.filter(kind="payment_confirmed").count() == 1

    def test_amount_tampering_with_a_valid_signature_still_cannot_underpay(self, api, attempt):
        payload = {
            "id": "evt_cheap",
            "type": "demo.payment.succeeded",
            "reference": attempt.reference,
            "amount": "0.01",
            "currency": "USD",
        }
        body = json.dumps(payload).encode()
        res = api.generic(
            "POST",
            "/api/v1/payments/webhooks/demo/",
            body,
            content_type="application/json",
            HTTP_X_DEMO_SIGNATURE=demo_mod.sign(body),
        )
        assert res.json()["outcome"] == "error"
        attempt.refresh_from_db()
        assert attempt.status != "PAID"
