"""Cash (pay at pickup / on delivery). Settled by staff (`payments.collect`), never by a provider callback."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal

from .base import InvalidWebhook, PaymentProvider, ProviderEvent, ProviderPayment, ProviderRefund

MANUAL_REFUND_REFERENCE = "manual-cash"


class CashProvider(PaymentProvider):
    key = "cash"
    label = "Pay at pickup / on delivery"
    description = "Pay with cash or card terminal when you collect or receive your order."
    is_sandbox = False
    offline = True

    def create_payment(self, payment, *, return_url: str, cancel_url: str) -> ProviderPayment:
        return ProviderPayment(reference="")

    def verify_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> ProviderEvent:
        raise InvalidWebhook("Cash payments have no provider webhooks.")

    def retrieve(self, payment) -> ProviderEvent | None:
        return None

    def refund(self, payment, amount: Decimal, idempotency_key: str, reason: str) -> ProviderRefund:
        # Money is handed back by staff in person; this only records that fact. No provider is contacted.
        return ProviderRefund(reference=MANUAL_REFUND_REFERENCE, status="succeeded")
