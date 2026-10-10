"""Stripe adapter: hosted Checkout (redirect), signed webhooks, API retrieval and refunds.

Card data never touches this server. Webhook authenticity is verified with `stripe.Webhook.construct_event` against the
raw request body; the verified payload is then normalised to a `ProviderEvent` (no personal data is retained).
Only the official SDK's network boundary (`Session.create/retrieve/expire`, `Refund.create`) is ever called.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal

import stripe
from django.conf import settings

from apps.payments.currency import from_minor, to_minor

from .base import (
    CANCELLED,
    FAILED,
    KIND_IGNORED,
    KIND_PAYMENT,
    KIND_REFUND,
    PAID,
    PENDING,
    REFUND_CUMULATIVE,
    REFUND_FAILED,
    REFUND_PENDING,
    REFUND_SUCCEEDED,
    InvalidWebhook,
    PaymentProvider,
    ProviderError,
    ProviderEvent,
    ProviderPayment,
    ProviderRefund,
)

log = logging.getLogger(__name__)

SIGNATURE_HEADER = "Stripe-Signature"
SESSION_EVENTS = {
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
}


def _header(headers: Mapping[str, str], name: str) -> str:
    for k, v in headers.items():
        if k.lower() == name.lower():
            return v
    return ""


def _safe_error(exc: stripe.StripeError) -> ProviderError:
    """Translate an SDK error to a customer/staff-safe message. The technical cause is logged without secrets."""
    log.error(
        "stripe call failed: %s code=%s status=%s request_id=%s",
        type(exc).__name__,
        getattr(exc, "code", None),
        getattr(exc, "http_status", None),
        getattr(exc, "request_id", None),
    )
    if isinstance(exc, stripe.APIConnectionError):
        return ProviderError(
            "We could not reach the payment provider. Please try again.", code="provider_unreachable", retryable=True
        )
    if isinstance(exc, stripe.RateLimitError):
        return ProviderError(
            "The payment provider is busy. Please try again in a moment.", code="provider_busy", retryable=True
        )
    if isinstance(exc, stripe.AuthenticationError):
        return ProviderError("Card payments are temporarily unavailable.", code="provider_misconfigured")
    if isinstance(exc, stripe.IdempotencyError):
        return ProviderError(
            "A conflicting payment request is already in progress.",
            code="provider_idempotency_conflict",
            retryable=True,
        )
    if isinstance(exc, stripe.InvalidRequestError):
        return ProviderError("The payment provider rejected this request.", code="provider_rejected")
    return ProviderError("The payment provider could not complete the request.", code="provider_error", retryable=True)


def _field(obj, key, default=None):
    """Item access that works for plain dicts and for the SDK's StripeObject (which is not a dict)."""
    try:
        return obj[key]
    except (KeyError, TypeError):
        return default


def _obj(event: dict) -> dict:
    return (event.get("data") or {}).get("object") or {}


def _meta_int(meta: Mapping | None, key: str) -> int | None:
    try:
        return int((meta or {}).get(key))
    except (TypeError, ValueError):
        return None


def _session_event(
    event_id: str, event_type: str, session: dict, *, status: str, raw_extra: dict | None = None
) -> ProviderEvent:
    currency = str(session.get("currency") or "").upper()
    meta = session.get("metadata") or {}
    intent = session.get("payment_intent")  # id string, or an expanded object
    intent_id = str(intent.get("id", "")) if isinstance(intent, dict) else str(intent or "")
    return ProviderEvent(
        id=event_id,
        type=event_type,
        reference=str(session.get("id") or ""),
        status=status,
        amount=from_minor(session.get("amount_total"), currency) if currency else None,
        currency=currency,
        kind=KIND_PAYMENT,
        payment_id=_meta_int(meta, "payment_id"),
        provider_charge_id=intent_id,
        raw={
            "event_type": event_type,
            "session_id": session.get("id"),
            "payment_status": session.get("payment_status"),
            "status": session.get("status"),
            "amount_total": session.get("amount_total"),
            "currency": session.get("currency"),
            "payment_intent": intent_id or None,
            "order_number": meta.get("order_number"),
            **(raw_extra or {}),
        },
    )


def normalize_event(event: dict) -> ProviderEvent:
    """Map a (signature-verified) Stripe event dict to a ProviderEvent. Unknown/irrelevant types are `ignored`."""
    event_id = str(event.get("id") or "")
    etype = str(event.get("type") or "")
    obj = _obj(event)

    if etype in SESSION_EVENTS:
        if obj.get("mode") not in (None, "payment"):
            return ProviderEvent(
                id=event_id,
                type=etype,
                reference=str(obj.get("id", "")),
                status="ignored",
                kind=KIND_IGNORED,
                raw={"event_type": etype},
            )
        payment_status = obj.get("payment_status")
        if etype == "checkout.session.expired":
            status = CANCELLED
        elif etype == "checkout.session.async_payment_failed":
            status = FAILED
        elif payment_status == "paid":
            status = PAID
        else:  # "unpaid" (async method in flight) or anything unexpected: never treat as paid
            status = PENDING
        failure_code = "async_payment_failed" if status == FAILED else ""
        failure_message = (
            "The payment could not be completed. Please try again or use another method." if status == FAILED else ""
        )
        ev = _session_event(event_id, etype, obj, status=status)
        return ProviderEvent(**{**ev.__dict__, "failure_code": failure_code, "failure_message": failure_message})

    if etype == "payment_intent.payment_failed":
        err = obj.get("last_payment_error") or {}
        meta = obj.get("metadata") or {}
        currency = str(obj.get("currency") or "").upper()
        return ProviderEvent(
            id=event_id,
            type=etype,
            reference=str(obj.get("id", "")),
            status=FAILED,
            amount=from_minor(obj.get("amount"), currency) if currency else None,
            currency=currency,
            failure_code=str(err.get("decline_code") or err.get("code") or "payment_failed")[:60],
            failure_message=str(err.get("message") or "The payment was declined.")[:300],
            kind=KIND_PAYMENT,
            payment_id=_meta_int(meta, "payment_id"),
            provider_charge_id=str(obj.get("id", "")),
            raw={
                "event_type": etype,
                "payment_intent": obj.get("id"),
                "amount": obj.get("amount"),
                "currency": obj.get("currency"),
                "error_code": err.get("code"),
                "decline_code": err.get("decline_code"),
            },
        )

    if etype == "charge.refunded":
        currency = str(obj.get("currency") or "").upper()
        meta = obj.get("metadata") or {}
        return ProviderEvent(
            id=event_id,
            type=etype,
            reference=str(obj.get("payment_intent") or ""),
            status=REFUND_CUMULATIVE,
            amount=from_minor(obj.get("amount_refunded"), currency) if currency else None,
            currency=currency,
            kind=KIND_REFUND,
            payment_id=_meta_int(meta, "payment_id"),
            provider_charge_id=str(obj.get("payment_intent") or ""),
            raw={
                "event_type": etype,
                "charge": obj.get("id"),
                "payment_intent": obj.get("payment_intent"),
                "amount_refunded": obj.get("amount_refunded"),
                "currency": obj.get("currency"),
            },
        )

    if etype in {"refund.updated", "refund.failed"}:
        currency = str(obj.get("currency") or "").upper()
        meta = obj.get("metadata") or {}
        raw_status = obj.get("status")
        status = {"succeeded": REFUND_SUCCEEDED, "failed": REFUND_FAILED, "canceled": REFUND_FAILED}.get(
            raw_status, REFUND_PENDING
        )
        if etype == "refund.failed":
            status = REFUND_FAILED
        return ProviderEvent(
            id=event_id,
            type=etype,
            reference=str(obj.get("id", "")),
            status=status,
            amount=from_minor(obj.get("amount"), currency) if currency else None,
            currency=currency,
            failure_code=str(obj.get("failure_reason") or "")[:60],
            failure_message="The provider could not complete this refund." if status == REFUND_FAILED else "",
            kind=KIND_REFUND,
            payment_id=_meta_int(meta, "payment_id"),
            provider_charge_id=str(obj.get("payment_intent") or ""),
            refund_key=str(meta.get("refund_key") or ""),
            raw={
                "event_type": etype,
                "refund": obj.get("id"),
                "status": raw_status,
                "amount": obj.get("amount"),
                "currency": obj.get("currency"),
                "payment_intent": obj.get("payment_intent"),
            },
        )

    return ProviderEvent(
        id=event_id, type=etype, reference="", status="ignored", kind=KIND_IGNORED, raw={"event_type": etype}
    )


class StripeProvider(PaymentProvider):
    key = "stripe"
    label = "Card (Stripe)"
    description = "Pay securely by card on Stripe's hosted checkout page."
    is_sandbox = False
    offline = False

    def sandbox(self) -> bool:
        """Test-mode keys never move real money; say so honestly."""
        return self.sandbox_mode()

    # ── helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _api_key() -> str:
        return settings.STRIPE_SECRET_KEY

    @staticmethod
    def sandbox_mode() -> bool:
        return settings.STRIPE_SECRET_KEY.startswith(("sk_test_", "rk_test_"))

    # ── PaymentProvider ────────────────────────────────────────────────────
    def create_payment(self, payment, *, return_url: str, cancel_url: str) -> ProviderPayment:
        order = payment.order
        currency = payment.currency.lower()
        minor = to_minor(payment.amount, currency)  # server-side amount only
        meta = {"payment_id": str(payment.pk), "order_number": order.number}
        # Stripe requires 30 min <= expires_at <= 24h; keep the page alive just past the unpaid-order expiry window.
        expires_epoch = int(time.time()) + max(31, settings.UNPAID_ORDER_EXPIRY_MINUTES + 2) * 60
        try:
            session = stripe.checkout.Session.create(
                api_key=self._api_key(),
                idempotency_key=payment.idempotency_key,
                mode="payment",
                client_reference_id=order.number,
                customer_email=order.customer_email or None,
                line_items=[
                    {
                        "quantity": 1,
                        "price_data": {
                            "currency": currency,
                            "unit_amount": minor,
                            "product_data": {"name": f"Order {order.number}"},
                        },
                    }
                ],
                metadata=meta,
                payment_intent_data={"metadata": meta, "description": f"Order {order.number}"},
                success_url=return_url,
                cancel_url=cancel_url,
                expires_at=expires_epoch,
            )
        except stripe.StripeError as exc:
            raise _safe_error(exc) from exc
        session_id, url = _field(session, "id"), _field(session, "url")
        if not session_id or not url:
            log.error("stripe session created without id/url for payment %s", payment.pk)
            raise ProviderError("The payment provider returned an unexpected response.", code="provider_bad_response")
        expires = _field(session, "expires_at")
        return ProviderPayment(
            reference=session_id,
            action_url=url,
            expires_at=datetime.fromtimestamp(int(expires or expires_epoch), tz=UTC),
        )

    def verify_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> ProviderEvent:
        secret = settings.STRIPE_WEBHOOK_SECRET
        if not secret:
            raise InvalidWebhook("Stripe webhook secret is not configured.")
        signature = _header(headers, SIGNATURE_HEADER)
        try:
            stripe.Webhook.construct_event(raw_body, signature, secret)
        except ValueError as exc:
            raise InvalidWebhook("Invalid payload.") from exc
        except stripe.SignatureVerificationError as exc:
            raise InvalidWebhook("Invalid signature.") from exc
        try:
            event = json.loads(raw_body)
        except ValueError as exc:  # pragma: no cover - construct_event already parsed it
            raise InvalidWebhook("Invalid payload.") from exc
        return normalize_event(event)

    def retrieve(self, payment) -> ProviderEvent | None:
        if not payment.reference:
            return None
        try:
            session = stripe.checkout.Session.retrieve(payment.reference, api_key=self._api_key())
        except stripe.StripeError as exc:
            raise _safe_error(exc) from exc
        data = session.to_dict() if hasattr(session, "to_dict") else dict(session)
        payment_status, status = data.get("payment_status"), data.get("status")
        if payment_status == "paid":
            mapped = PAID
        elif status == "expired":
            mapped = CANCELLED
        else:
            mapped = PENDING
        event_id = f"sync:{data.get('id')}:{status}:{payment_status}"
        return _session_event(event_id, "checkout.session.sync", data, status=mapped)

    def refund(self, payment, amount: Decimal, idempotency_key: str, reason: str) -> ProviderRefund:
        intent = payment.provider_charge_id
        if not intent:
            event = self.retrieve(payment)  # the intent id is only known once the session was completed
            intent = event.provider_charge_id if event else ""
        if not intent:
            raise ProviderError("This payment has no completed charge to refund at the provider.", code="no_charge")
        try:
            result = stripe.Refund.create(
                api_key=self._api_key(),
                idempotency_key=idempotency_key,
                payment_intent=intent,
                amount=to_minor(amount, payment.currency),
                reason="requested_by_customer",
                metadata={"refund_key": idempotency_key, "payment_id": str(payment.pk), "note": (reason or "")[:200]},
            )
        except stripe.StripeError as exc:
            raise _safe_error(exc) from exc
        status = result["status"]
        if status == "succeeded":
            return ProviderRefund(reference=result["id"], status="succeeded")
        if status in {"pending", "requires_action"}:
            return ProviderRefund(reference=result["id"], status="pending")
        raise ProviderError("The payment provider could not complete this refund.", code="refund_" + str(status))

    def cancel_attempt(self, payment) -> None:
        if not payment.reference:
            return
        try:
            stripe.checkout.Session.expire(payment.reference, api_key=self._api_key())
        except stripe.StripeError as exc:  # already completed/expired, or provider down: nothing more we can do
            log.info("could not expire stripe session for payment %s: %s", payment.pk, type(exc).__name__)
