import json
import time
from decimal import Decimal

import pytest
import stripe

from apps.core.errors import DomainError
from apps.payments import registry
from apps.payments.currency import from_minor, to_minor
from apps.payments.providers import demo as demo_mod
from apps.payments.providers.base import InvalidWebhook
from apps.payments.providers.cash import CashProvider
from apps.payments.providers.demo import DemoProvider
from apps.payments.providers.stripe import StripeProvider, normalize_event

from .helpers import make_order, make_payment, session_object, signed_webhook, stripe_event, stripe_signature


class TestCurrency:
    @pytest.mark.parametrize(
        ("amount", "currency", "minor"),
        [("12.34", "USD", 1234), ("0.50", "eur", 50), ("1500.00", "JPY", 1500), ("1.230", "KWD", 1230)],
    )
    def test_round_trip(self, amount, currency, minor):
        assert to_minor(Decimal(amount), currency) == minor
        assert from_minor(minor, currency) == Decimal(amount).quantize(Decimal("0.01"))

    def test_zero_decimal_rejects_fractions(self):
        with pytest.raises(DomainError) as exc:
            to_minor(Decimal("10.50"), "JPY")
        assert exc.value.detail.code == "unsupported_amount"


class TestStripeSignature:
    secret = "whsec_unit_tests_only"

    def _event(self):
        return stripe_event(
            "checkout.session.completed",
            {"id": "cs_1", "mode": "payment", "payment_status": "paid", "amount_total": 1000, "currency": "usd"},
        )

    def test_valid_signature_is_accepted(self):
        body, headers = signed_webhook(self._event())
        event = StripeProvider().verify_webhook(body, {"Stripe-Signature": headers["HTTP_STRIPE_SIGNATURE"]})
        assert event.reference == "cs_1"
        assert event.status == "paid"
        assert event.amount == Decimal("10.00")

    def test_invalid_signature_is_rejected(self):
        body, _ = signed_webhook(self._event())
        with pytest.raises(InvalidWebhook):
            StripeProvider().verify_webhook(body, {"Stripe-Signature": stripe_signature(body, secret="whsec_wrong")})

    def test_tampered_body_is_rejected(self):
        body, headers = signed_webhook(self._event())
        tampered = body.replace(b'"amount_total": 1000', b'"amount_total": 1')
        assert tampered != body
        with pytest.raises(InvalidWebhook):
            StripeProvider().verify_webhook(tampered, {"Stripe-Signature": headers["HTTP_STRIPE_SIGNATURE"]})

    def test_stale_timestamp_is_rejected(self):
        body = json.dumps(self._event()).encode()
        header = stripe_signature(body, timestamp=int(time.time()) - 3600)
        with pytest.raises(InvalidWebhook):
            StripeProvider().verify_webhook(body, {"Stripe-Signature": header})

    def test_missing_header_and_garbage_are_rejected(self):
        body, _ = signed_webhook(self._event())
        with pytest.raises(InvalidWebhook):
            StripeProvider().verify_webhook(body, {})
        with pytest.raises(InvalidWebhook):
            StripeProvider().verify_webhook(b"not json", {"Stripe-Signature": stripe_signature(b"not json")})

    def test_unconfigured_secret_rejects_everything(self, settings):
        settings.STRIPE_WEBHOOK_SECRET = ""
        body, headers = signed_webhook(self._event(), secret="")
        with pytest.raises(InvalidWebhook):
            StripeProvider().verify_webhook(body, {"Stripe-Signature": headers["HTTP_STRIPE_SIGNATURE"]})


@pytest.mark.django_db
class TestStripeNormalization:
    def test_unpaid_completed_session_stays_pending(self):
        payment = make_payment(make_order(payment_method="stripe"), "stripe")
        ev = normalize_event(
            stripe_event("checkout.session.completed", session_object(payment, payment_status="unpaid"))
        )
        assert ev.status == "pending"

    def test_async_events_and_expiry(self):
        payment = make_payment(make_order(payment_method="stripe"), "stripe")
        sess = session_object(payment)
        assert normalize_event(stripe_event("checkout.session.async_payment_succeeded", sess)).status == "paid"
        assert normalize_event(stripe_event("checkout.session.async_payment_failed", sess)).status == "failed"
        assert normalize_event(stripe_event("checkout.session.expired", sess)).status == "cancelled"

    def test_personal_data_is_not_kept(self):
        payment = make_payment(make_order(payment_method="stripe"), "stripe")
        ev = normalize_event(stripe_event("checkout.session.completed", session_object(payment)))
        assert "secret-person@example.com" not in json.dumps(ev.raw)
        assert "customer_details" not in ev.raw

    def test_intent_failure_carries_safe_message(self):
        obj = {
            "id": "pi_1",
            "amount": 500,
            "currency": "usd",
            "metadata": {"payment_id": "7"},
            "last_payment_error": {
                "code": "card_declined",
                "decline_code": "insufficient_funds",
                "message": "Your card has insufficient funds.",
            },
        }
        ev = normalize_event(stripe_event("payment_intent.payment_failed", obj))
        assert (ev.status, ev.failure_code, ev.payment_id, ev.amount) == (
            "failed",
            "insufficient_funds",
            7,
            Decimal("5.00"),
        )

    def test_unrelated_event_is_ignored(self):
        assert normalize_event(stripe_event("customer.created", {"id": "cus_1"})).kind == "ignored"


@pytest.mark.django_db
class TestStripeCreate:
    def test_session_params_are_server_computed(self, monkeypatch):
        order = make_order(payment_method="stripe", items=[("Beans", "19.99", 2)])
        payment = make_payment(order, "stripe", "PENDING", reference="")
        seen = {}

        def fake_create(**params):
            seen.update(params)
            return stripe.checkout.Session.construct_from(
                {
                    "id": "cs_test_1",
                    "url": "https://checkout.stripe.test/cs_test_1",
                    "expires_at": int(time.time()) + 3600,
                },
                "k",
            )

        monkeypatch.setattr(stripe.checkout.Session, "create", fake_create)
        result = StripeProvider().create_payment(
            payment, return_url="https://shop.test/ok", cancel_url="https://shop.test/no"
        )
        assert result.reference == "cs_test_1" and result.action_url.startswith("https://checkout.stripe.test/")
        item = seen["line_items"][0]
        assert item["price_data"]["unit_amount"] == 3998 and item["price_data"]["currency"] == "usd"
        assert item["price_data"]["product_data"]["name"] == f"Order {order.number}"
        assert seen["client_reference_id"] == order.number
        assert seen["metadata"] == {"payment_id": str(payment.pk), "order_number": order.number}
        assert seen["idempotency_key"] == payment.idempotency_key
        assert (
            seen["mode"] == "payment"
            and seen["success_url"] == "https://shop.test/ok"
            and seen["cancel_url"] == "https://shop.test/no"
        )

    def test_zero_decimal_currency(self, monkeypatch):
        order = make_order(payment_method="stripe", currency="JPY", items=[("Beans", "1500.00", 1)])
        payment = make_payment(order, "stripe", reference="")
        seen = {}
        monkeypatch.setattr(
            stripe.checkout.Session, "create", lambda **p: seen.update(p) or {"id": "cs_j", "url": "https://x.test/j"}
        )
        StripeProvider().create_payment(payment, return_url="https://a.test/", cancel_url="https://a.test/")
        assert seen["line_items"][0]["price_data"]["unit_amount"] == 1500

    def test_api_errors_become_safe_provider_errors(self, monkeypatch):
        from apps.payments.providers.base import ProviderError

        order = make_order(payment_method="stripe")
        payment = make_payment(order, "stripe", reference="")

        def boom(**_):
            raise stripe.APIConnectionError("sk_test_unit_tests_only exploded")

        monkeypatch.setattr(stripe.checkout.Session, "create", boom)
        with pytest.raises(ProviderError) as exc:
            StripeProvider().create_payment(payment, return_url="https://a.test/", cancel_url="https://a.test/")
        assert "sk_test" not in exc.value.safe_message and exc.value.retryable


class TestDemoProvider:
    def test_signature_round_trip_and_rejection(self):
        body = json.dumps(
            {"id": "e1", "type": "demo.payment.succeeded", "reference": "demo_x", "amount": "5.00", "currency": "USD"}
        ).encode()
        p = DemoProvider()
        ev = p.verify_webhook(body, {demo_mod.SIGNATURE_HEADER: demo_mod.sign(body)})
        assert (ev.status, ev.amount, ev.reference) == ("paid", Decimal("5.00"), "demo_x")
        with pytest.raises(InvalidWebhook):
            p.verify_webhook(body, {demo_mod.SIGNATURE_HEADER: "0" * 64})
        with pytest.raises(InvalidWebhook):
            p.verify_webhook(body + b" ", {demo_mod.SIGNATURE_HEADER: demo_mod.sign(body)})
        with pytest.raises(InvalidWebhook):
            p.verify_webhook(body, {})

    def test_malformed_signed_payload_is_rejected(self):
        body = b'{"type": "nope"}'
        with pytest.raises(InvalidWebhook):
            DemoProvider().verify_webhook(body, {demo_mod.SIGNATURE_HEADER: demo_mod.sign(body)})

    def test_labelled_sandbox(self):
        p = DemoProvider()
        assert p.is_sandbox and "no real money" in p.description


class TestCashProvider:
    def test_refund_is_a_manual_record(self):
        refund = CashProvider().refund(None, Decimal("3.00"), "k", "r")
        assert (refund.reference, refund.status) == ("manual-cash", "succeeded")

    def test_has_no_webhooks(self):
        with pytest.raises(InvalidWebhook):
            CashProvider().verify_webhook(b"", {})


@pytest.mark.django_db
class TestRegistry:
    def test_enabled_keys_follow_settings(self, settings):
        settings.PAYMENT_PROVIDERS_ENABLED = ["cash", "stripe"]
        assert registry.enabled_provider_keys() == ["cash", "stripe"]

    def test_demo_never_available_when_disabled(self, settings):
        settings.PAYMENT_PROVIDERS_ENABLED = ["demo", "cash"]
        settings.PAYMENT_DEMO_ENABLED = False
        assert registry.enabled_provider_keys() == ["cash"]
        with pytest.raises(DomainError):
            registry.get_provider("demo")

    def test_stripe_needs_credentials(self, settings):
        settings.STRIPE_SECRET_KEY = ""
        assert "stripe" not in registry.enabled_provider_keys()

    def test_store_allow_list_narrows_methods(self, store_settings):
        store_settings.allowed_checkout_methods = ["cash"]
        store_settings.save()
        from apps.core.cache import bump

        bump("catalog")
        assert registry.enabled_provider_keys() == ["cash"]

    def test_unknown_provider(self):
        with pytest.raises(DomainError):
            registry.get_provider("paypal")

    def test_methods_describe_sandbox_flag(self):
        methods = {m["key"]: m for m in registry.describe_methods()}
        assert methods["demo"]["is_sandbox"] is True and methods["cash"]["offline"] is True
        assert methods["stripe"]["is_sandbox"] is True  # test-mode key in test settings

    def test_describe_payment_without_attempts(self):
        order = make_order(payment_method="demo")
        d = registry.describe_payment(order)
        assert d["status"] == "PENDING" and d["action"] is None and d["can_retry"] is True and d["provider"] == "demo"

    def test_describe_payment_requires_action_and_failure(self):
        order = make_order(payment_method="demo", payment_status="REQUIRES_ACTION")
        make_payment(
            order, "demo", "REQUIRES_ACTION", reference="demo_abc", action_url="https://shop.test/pay/demo/demo_abc"
        )
        d = registry.describe_payment(order)
        assert (
            d["action"] == {"type": "redirect", "url": "https://shop.test/pay/demo/demo_abc"}
            and d["is_sandbox"] is True
        )
        order2 = make_order(payment_method="demo", payment_status="FAILED")
        make_payment(order2, "demo", "FAILED", failure_message="Declined")
        d2 = registry.describe_payment(order2)
        assert d2["failure_message"] == "Declined" and d2["can_retry"] is True

    def test_cash_and_paid_orders_cannot_retry(self):
        assert registry.describe_payment(make_order(payment_method="cash"))["can_retry"] is False
        assert registry.describe_payment(make_order(payment_status="PAID"))["can_retry"] is False
