"""Provider-neutral payment abstraction.

A provider turns an internal `Payment` attempt into something the customer can act on, verifies provider callbacks
and normalises them into a `ProviderEvent`, and executes refunds. Services never import SDKs; they only talk to this
interface, so adding a provider means adding one module and registering it in `registry.py`.
"""

from __future__ import annotations

import abc
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal


class ProviderError(Exception):
    """A provider call failed. `safe_message` is shown to staff/customers; the technical cause is only logged."""

    def __init__(self, safe_message: str, *, code: str = "provider_error", retryable: bool = False):
        super().__init__(safe_message)
        self.safe_message = safe_message
        self.code = code
        self.retryable = retryable


class InvalidWebhook(Exception):
    """Signature or payload verification failed. Never include secrets or signature material in the message."""


# ProviderEvent.kind
KIND_PAYMENT = "payment"
KIND_REFUND = "refund"
KIND_IGNORED = "ignored"

# ProviderEvent.status for kind=payment
PAID = "paid"
PENDING = "pending"  # provider says "not yet" (e.g. async payment methods): wait for a later event
FAILED = "failed"
CANCELLED = "cancelled"
# ProviderEvent.status for kind=refund
REFUND_SUCCEEDED = "succeeded"
REFUND_PENDING = "pending"
REFUND_FAILED = "failed"
REFUND_CUMULATIVE = "cumulative"  # `amount` is the provider's total refunded amount for the charge


@dataclass(frozen=True)
class ProviderEvent:
    id: str
    type: str
    reference: str  # provider object id: checkout session / demo reference / payment intent / refund id
    status: str
    amount: Decimal | None = None
    currency: str = ""
    failure_code: str = ""
    failure_message: str = ""
    kind: str = KIND_PAYMENT
    payment_id: int | None = None  # our Payment.pk, when the provider echoes our metadata
    provider_charge_id: str = ""  # provider-side charge / payment-intent id
    refund_key: str = ""  # our Refund.idempotency_key, when echoed by the provider
    raw: dict = field(default_factory=dict)  # sanitised: no card data, no personal data, no secrets


@dataclass(frozen=True)
class ProviderPayment:
    reference: str
    action_url: str = ""  # empty = no customer action required
    expires_at: object = None  # aware datetime | None
    provider_charge_id: str = ""


@dataclass(frozen=True)
class ProviderRefund:
    reference: str
    status: str  # "succeeded" | "pending"


class PaymentProvider(abc.ABC):
    key: str = ""
    label: str = ""
    description: str = ""
    is_sandbox: bool = False
    offline: bool = False  # settled outside the system (cash)

    @abc.abstractmethod
    def create_payment(self, payment, *, return_url: str, cancel_url: str) -> ProviderPayment:
        """Create the provider-side object for `payment` (server-computed amount). Raises ProviderError."""

    @abc.abstractmethod
    def verify_webhook(self, raw_body: bytes, headers: Mapping[str, str]) -> ProviderEvent:
        """Verify authenticity against the RAW body and return a normalised event. Raises InvalidWebhook."""

    @abc.abstractmethod
    def retrieve(self, payment) -> ProviderEvent | None:
        """Ask the provider for the current truth about `payment` as a synthetic, deterministic-id event."""

    @abc.abstractmethod
    def refund(self, payment, amount: Decimal, idempotency_key: str, reason: str) -> ProviderRefund:
        """Refund `amount` of a settled payment. Raises ProviderError."""

    def sandbox(self) -> bool:
        """Whether payments through this provider (as currently configured) move no real money."""
        return self.is_sandbox

    def cancel_attempt(self, payment) -> None:  # noqa: B027 - optional hook
        """Best-effort: stop the customer from paying a superseded/abandoned attempt."""

    def action_for(self, payment) -> dict | None:
        """Customer-facing next step for a live attempt, e.g. {"type": "redirect", "url": ...}."""
        if payment.status == "REQUIRES_ACTION" and payment.action_url:
            return {"type": "redirect", "url": payment.action_url}
        return None


def sanitize(source: Mapping, allowed: tuple[str, ...]) -> dict:
    """Whitelist copy used to build `ProviderEvent.raw` (events are stored; they must not hold personal data)."""
    return {k: source.get(k) for k in allowed if k in source and not isinstance(source.get(k), (dict, list))}
