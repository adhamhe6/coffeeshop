"""Sandbox payment simulator. No real money ever moves.

It is deliberately built like a real provider: the "complete" endpoint produces a *signed* event (HMAC-SHA256 with
`PAYMENT_DEMO_WEBHOOK_SECRET`) and feeds it through `verify_webhook` + `handle_provider_event`, so tests and demos
exercise exactly the same code path as Stripe webhooks. The registry never offers it when `PAYMENT_DEMO_ENABLED` is off.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation

from django.conf import settings

from .base import (
    CANCELLED,
    FAILED,
    KIND_PAYMENT,
    PAID,
    InvalidWebhook,
    PaymentProvider,
    ProviderEvent,
    ProviderPayment,
    ProviderRefund,
    sanitize,
)

SIGNATURE_HEADER = "X-Demo-Signature"
SANDBOX_NOTICE = "Sandbox payment — no real money moves."
OUTCOMES = {
    "success": ("demo.payment.succeeded", PAID),
    "decline": ("demo.payment.failed", FAILED),
    "cancel": ("demo.payment.cancelled", CANCELLED),
}
_TYPE_TO_STATUS = dict(OUTCOMES.values())
DECLINE_CODE = "demo_declined"
DECLINE_MESSAGE = "The sandbox payment was declined (simulated)."


def _header(headers: Mapping[str, str], name: str) -> str:
    for k, v in headers.items():
        if k.lower() == name.lower():
            return v
    return ""


def sign(body: bytes) -> str:
    return hmac.new(settings.PAYMENT_DEMO_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def event_id_for(reference: str, outcome: str) -> str:
    return f"demo_evt_{reference}_{outcome}"


def build_signed_event(payment, outcome: str) -> tuple[bytes, dict[str, str]]:
    """Return (raw_body, headers) exactly as an external demo webhook sender would deliver them."""
    event_type, _ = OUTCOMES[outcome]
    payload = {
        "id": event_id_for(payment.reference, outcome),
        "type": event_type,
        "reference": payment.reference,
        "amount": str(payment.amount),
        "currency": payment.currency,
    }
    if outcome == "decline":
        payload.update(failure_code=DECLINE_CODE, failure_message=DECLINE_MESSAGE)
    body = json.dumps(payload, sort_keys=True).encode()
    return body, {SIGNATURE_HEADER: sign(body)}


class DemoProvider(PaymentProvider):
    key = "demo"
    label = "Sandbox payment"
    description = SANDBOX_NOTICE
    is_sandbox = True
    offline = False

    def create_payment(self, payment, *, return_url: str, cancel_url: str) -> ProviderPayment:
        reference = f"demo_{secrets.token_urlsafe(18)}"
        return ProviderPayment(reference=reference, action_url=f"{settings.SITE_URL.rstrip('/')}/pay/demo/{reference}")

    def verify_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> ProviderEvent:
        signature = _header(headers, SIGNATURE_HEADER)
        # Compare bytes: str inputs raise TypeError for non-ASCII header values (an unauthenticated 500).
        if not signature or not hmac.compare_digest(signature.encode("utf-8", "replace"), sign(raw_body).encode()):
            raise InvalidWebhook("Invalid demo signature.")
        try:
            data = json.loads(raw_body)
            event_type = data["type"]
            status = _TYPE_TO_STATUS[event_type]
            amount = Decimal(str(data["amount"])) if data.get("amount") is not None else None
            return ProviderEvent(
                id=str(data["id"])[:120],
                type=event_type,
                reference=str(data["reference"]),
                status=status,
                amount=amount,
                currency=str(data.get("currency", "")).upper(),
                failure_code=str(data.get("failure_code", ""))[:60],
                failure_message=str(data.get("failure_message", ""))[:300],
                kind=KIND_PAYMENT,
                raw=sanitize(data, ("id", "type", "reference", "amount", "currency", "failure_code")),
            )
        except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
            raise InvalidWebhook("Malformed demo event.") from exc

    def retrieve(self, payment) -> ProviderEvent | None:
        return None  # the sandbox has no remote state to consult

    def refund(self, payment, amount: Decimal, idempotency_key: str, reason: str) -> ProviderRefund:
        return ProviderRefund(
            reference=f"demo_re_{hashlib.sha1(idempotency_key.encode(), usedforsecurity=False).hexdigest()[:16]}",
            status="succeeded",
        )
