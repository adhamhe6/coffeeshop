import json
import logging
import threading
import time

import pytest
import stripe
from django.db import connection
from django.test import Client

from apps.notifications.models import Notification
from apps.orders.models import Order
from apps.payments.models import Payment, PaymentEvent
from tests.factories import make_user

from .helpers import (
    make_order,
    make_payment,
    post_stripe_webhook,
    session_object,
    signed_webhook,
    stripe_event,
    stripe_signature,
)

URL = "/api/v1/payments/webhooks/stripe/"


@pytest.fixture
def owner():
    return make_user()


@pytest.fixture
def attempt(owner):
    order = make_order(owner, payment_method="stripe", payment_status="REQUIRES_ACTION", items=[("Beans", "21.50", 2)])
    return make_payment(
        order,
        "stripe",
        "REQUIRES_ACTION",
        reference="cs_test_live",
        action_url="https://checkout.stripe.test/cs_test_live",
        sandbox=True,
    )


@pytest.mark.django_db
class TestStripeWebhookEndpoint:
    def test_completed_paid_session_settles_the_order(self, api, attempt):
        res = post_stripe_webhook(api, stripe_event("checkout.session.completed", session_object(attempt)))
        assert res.status_code == 200 and res.json()["outcome"] == "applied"
        attempt.refresh_from_db()
        attempt.order.refresh_from_db()
        assert attempt.status == "PAID" and attempt.provider_charge_id == "pi_test_123" and attempt.paid_at
        assert attempt.order.payment_status == "PAID"
        assert Notification.objects.filter(order=attempt.order, kind="payment_confirmed").count() == 1

    def test_stored_event_is_sanitised(self, api, attempt):
        post_stripe_webhook(api, stripe_event("checkout.session.completed", session_object(attempt)))
        payload = json.dumps(PaymentEvent.objects.get().payload)
        assert "secret-person@example.com" not in payload and "Should Not Be Stored" not in payload

    def test_invalid_signature_is_400_logged_without_secrets(self, api, attempt, caplog):
        caplog.set_level(logging.INFO)
        body, _ = signed_webhook(stripe_event("checkout.session.completed", session_object(attempt)))
        res = api.generic(
            "POST",
            URL,
            body,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=stripe_signature(body, secret="whsec_attacker"),
        )
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_signature"
        assert "whsec_" not in res.content.decode() and "whsec_" not in caplog.text
        assert "rejected stripe webhook" in caplog.text
        attempt.refresh_from_db()
        assert attempt.status == "REQUIRES_ACTION" and PaymentEvent.objects.count() == 0

    def test_missing_signature_tampered_body_and_stale_timestamp_are_400(self, api, attempt):
        ev = stripe_event("checkout.session.completed", session_object(attempt))
        body, headers = signed_webhook(ev)
        assert api.generic("POST", URL, body, content_type="application/json").status_code == 400
        tampered = body.replace(attempt.reference.encode(), b"cs_test_other")
        assert api.generic("POST", URL, tampered, content_type="application/json", **headers).status_code == 400
        stale_body, stale = signed_webhook(ev, timestamp=int(time.time()) - 7200)
        assert api.generic("POST", URL, stale_body, content_type="application/json", **stale).status_code == 400
        attempt.refresh_from_db()
        assert attempt.status == "REQUIRES_ACTION"

    def test_only_post_is_allowed_and_no_auth_or_csrf_needed(self, attempt):
        client = Client(enforce_csrf_checks=True)
        assert client.get(URL).status_code == 405
        res = post_stripe_webhook(client, stripe_event("checkout.session.completed", session_object(attempt)))
        assert res.status_code == 200

    def test_five_sequential_duplicates_have_one_effect(self, api, attempt):
        ev = stripe_event("checkout.session.completed", session_object(attempt), event_id="evt_same")
        outcomes = [post_stripe_webhook(api, ev).json()["outcome"] for _ in range(5)]
        assert outcomes == ["applied"] + ["duplicate"] * 4
        assert PaymentEvent.objects.count() == 1
        assert Notification.objects.filter(kind="payment_confirmed").count() == 1

    def test_unpaid_then_async_success(self, api, attempt):
        r1 = post_stripe_webhook(
            api, stripe_event("checkout.session.completed", session_object(attempt, payment_status="unpaid"))
        )
        attempt.refresh_from_db()
        assert r1.json()["outcome"] == "ignored" and attempt.status == "REQUIRES_ACTION"
        r2 = post_stripe_webhook(api, stripe_event("checkout.session.async_payment_succeeded", session_object(attempt)))
        attempt.refresh_from_db()
        assert r2.json()["outcome"] == "applied" and attempt.status == "PAID"

    def test_async_failure_marks_failed_and_order_stays_pending(self, api, attempt):
        post_stripe_webhook(
            api, stripe_event("checkout.session.async_payment_failed", session_object(attempt, payment_status="unpaid"))
        )
        attempt.refresh_from_db()
        attempt.order.refresh_from_db()
        assert (
            attempt.status == "FAILED"
            and attempt.order.status == "PENDING"
            and attempt.order.payment_status == "FAILED"
        )
        assert Notification.objects.filter(kind="payment_failed").count() == 1

    def test_amount_and_currency_mismatch_never_mark_paid(self, api, attempt):
        post_stripe_webhook(api, stripe_event("checkout.session.completed", session_object(attempt, amount="1.00")))
        post_stripe_webhook(api, stripe_event("checkout.session.completed", session_object(attempt, currency="eur")))
        attempt.refresh_from_db()
        assert attempt.status == "REQUIRES_ACTION" and attempt.flagged_reason == "amount_mismatch"
        assert sorted(PaymentEvent.objects.values_list("outcome", flat=True)) == ["error", "error"]
        assert not Notification.objects.exists()

    def test_expired_session_cancels_attempt(self, api, attempt):
        post_stripe_webhook(
            api,
            stripe_event(
                "checkout.session.expired", session_object(attempt, payment_status="unpaid", status="expired")
            ),
        )
        attempt.refresh_from_db()
        attempt.order.refresh_from_db()
        assert attempt.status == "CANCELLED" and attempt.order.payment_status == "PENDING"

    def test_intent_failure_is_matched_by_metadata_and_records_reason(self, api, attempt):
        intent = {
            "id": "pi_decl",
            "amount": 4300,
            "currency": "usd",
            "metadata": {"payment_id": str(attempt.pk)},
            "last_payment_error": {
                "code": "card_declined",
                "decline_code": "generic_decline",
                "message": "Your card was declined.",
            },
        }
        res = post_stripe_webhook(api, stripe_event("payment_intent.payment_failed", intent))
        attempt.refresh_from_db()
        assert res.json()["outcome"] == "applied"
        assert (attempt.status, attempt.failure_code, attempt.failure_message) == (
            "FAILED",
            "generic_decline",
            "Your card was declined.",
        )

    def test_declined_card_then_success_in_same_session_settles(self, api, attempt):
        intent = {
            "id": "pi_test_123",
            "amount": 4300,
            "currency": "usd",
            "metadata": {"payment_id": str(attempt.pk)},
            "last_payment_error": {"code": "card_declined", "message": "Declined"},
        }
        post_stripe_webhook(api, stripe_event("payment_intent.payment_failed", intent))
        post_stripe_webhook(api, stripe_event("checkout.session.completed", session_object(attempt)))
        attempt.refresh_from_db()
        assert attempt.status == "PAID"
        assert Notification.objects.filter(kind="payment_failed").count() == 1

    def test_late_failure_after_paid_is_out_of_order(self, api, attempt):
        post_stripe_webhook(api, stripe_event("checkout.session.completed", session_object(attempt)))
        res = post_stripe_webhook(api, stripe_event("checkout.session.async_payment_failed", session_object(attempt)))
        attempt.refresh_from_db()
        assert res.json()["outcome"] == "out_of_order" and attempt.status == "PAID"

    def test_irrelevant_event_types_are_acknowledged(self, api):
        res = post_stripe_webhook(api, stripe_event("customer.created", {"id": "cus_1"}))
        assert res.status_code == 200 and res.json()["outcome"] == "ignored"

    def test_unknown_session_is_acknowledged_without_side_effects(self, api, attempt):
        obj = {**session_object(attempt), "id": "cs_other", "metadata": {}}
        res = post_stripe_webhook(api, stripe_event("checkout.session.completed", obj))
        attempt.refresh_from_db()
        assert res.json()["outcome"] == "ignored" and attempt.status == "REQUIRES_ACTION"

    def test_paid_with_auto_confirm_confirms_order(
        self, api, attempt, store_settings, django_capture_on_commit_callbacks
    ):
        store_settings.auto_confirm_paid_orders = True
        store_settings.save()
        with django_capture_on_commit_callbacks(execute=True):
            post_stripe_webhook(api, stripe_event("checkout.session.completed", session_object(attempt)))
        attempt.order.refresh_from_db()
        assert attempt.order.status == Order.Status.CONFIRMED
        assert set(Notification.objects.values_list("kind", flat=True)) == {"payment_confirmed", "order_confirmed"}


@pytest.mark.django_db(transaction=True)
class TestStripeWebhookConcurrency:
    def test_six_concurrent_deliveries_have_one_side_effect(self, owner):
        order = make_order(owner, payment_method="stripe", payment_status="REQUIRES_ACTION")
        attempt = make_payment(order, "stripe", "REQUIRES_ACTION", reference="cs_conc")
        body, headers = signed_webhook(
            stripe_event("checkout.session.completed", session_object(attempt), event_id="evt_conc")
        )
        outcomes, errors = [], []
        barrier = threading.Barrier(6)

        def worker():
            try:
                client = Client()
                barrier.wait()
                res = client.generic("POST", URL, body, content_type="application/json", **headers)
                outcomes.append((res.status_code, res.json()["outcome"]))
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors, errors
        assert sorted(o[1] for o in outcomes) == ["applied"] + ["duplicate"] * 5
        assert all(code == 200 for code, _ in outcomes)
        assert Notification.objects.filter(order=order, kind="payment_confirmed").count() == 1
        assert PaymentEvent.objects.count() == 1
        assert Payment.objects.get(pk=attempt.pk).status == "PAID"


@pytest.mark.django_db
class TestPaymentSync:
    def url(self, order):
        return f"/api/v1/orders/{order.number}/payment/sync/"

    def retrieved(self, attempt, **kw):
        return stripe.checkout.Session.construct_from(session_object(attempt, **kw), "k")

    def test_return_page_confirms_via_provider_retrieval(self, login, owner, attempt, monkeypatch):
        monkeypatch.setattr(stripe.checkout.Session, "retrieve", lambda sid, **kw: self.retrieved(attempt))
        res = login(owner).post(self.url(attempt.order))
        body = res.json()
        assert (
            res.status_code == 200
            and body["payment"]["status"] == "PAID"
            and body["order_number"] == attempt.order.number
        )
        assert body["payment"]["is_sandbox"] is True and body["payment"]["can_retry"] is False
        event = PaymentEvent.objects.get()
        assert event.event_id.startswith("sync:cs_test_live") and event.outcome == "applied"

    def test_repeated_sync_is_a_noop_and_agrees_with_the_webhook(self, login, owner, attempt, api, monkeypatch):
        monkeypatch.setattr(stripe.checkout.Session, "retrieve", lambda sid, **kw: self.retrieved(attempt))
        c = login(owner)
        c.post(self.url(attempt.order))
        c.post(self.url(attempt.order))
        post_stripe_webhook(APIClientNoSession(), stripe_event("checkout.session.completed", session_object(attempt)))
        assert Notification.objects.filter(kind="payment_confirmed").count() == 1
        assert Payment.objects.filter(order=attempt.order, status="PAID").count() == 1

    def test_unpaid_session_leaves_everything_alone(self, login, owner, attempt, monkeypatch):
        monkeypatch.setattr(
            stripe.checkout.Session,
            "retrieve",
            lambda sid, **kw: self.retrieved(attempt, payment_status="unpaid", status="open"),
        )
        body = login(owner).post(self.url(attempt.order)).json()
        assert body["payment"]["status"] == "REQUIRES_ACTION" and body["payment"]["action"]["type"] == "redirect"

    def test_expired_session_closes_the_attempt(self, login, owner, attempt, monkeypatch):
        monkeypatch.setattr(
            stripe.checkout.Session,
            "retrieve",
            lambda sid, **kw: self.retrieved(attempt, payment_status="unpaid", status="expired"),
        )
        body = login(owner).post(self.url(attempt.order)).json()
        assert body["payment"]["status"] == "PENDING" and body["payment"]["can_retry"] is True

    def test_provider_value_is_verified_not_browser_claims(self, login, owner, attempt, monkeypatch):
        monkeypatch.setattr(
            stripe.checkout.Session, "retrieve", lambda sid, **kw: self.retrieved(attempt, amount="0.50")
        )
        body = login(owner).post(self.url(attempt.order)).json()
        attempt.refresh_from_db()
        assert body["payment"]["status"] == "REQUIRES_ACTION" and attempt.status == "REQUIRES_ACTION"

    def test_provider_outage_is_502(self, login, owner, attempt, monkeypatch):
        def boom(*a, **k):
            raise stripe.APIConnectionError("down")

        monkeypatch.setattr(stripe.checkout.Session, "retrieve", boom)
        res = login(owner).post(self.url(attempt.order))
        assert res.status_code == 502 and res.json()["error"]["code"] == "payment_provider_unavailable"

    def test_other_customers_cannot_sync_foreign_orders(self, login, attempt, monkeypatch):
        monkeypatch.setattr(stripe.checkout.Session, "retrieve", lambda *a, **k: pytest.fail("must not call provider"))
        assert login(make_user()).post(self.url(attempt.order)).status_code == 404

    def test_anonymous_is_401(self, api, attempt):
        assert api.post(self.url(attempt.order)).status_code == 401

    def test_cash_orders_just_report_status(self, login, owner):
        order = make_order(owner, payment_method="cash")
        make_payment(order, "cash")
        body = login(owner).post(self.url(order)).json()
        assert body["payment"]["status"] == "PENDING" and body["payment"]["provider"] == "cash"


def APIClientNoSession():
    return Client()
