"""Provider registry and the order-facing payment summary used by order payloads."""

from __future__ import annotations

from django.conf import settings

from apps.core.errors import DomainError

from .providers.base import PaymentProvider

_FACTORIES = {
    "stripe": "apps.payments.providers.stripe.StripeProvider",
    "demo": "apps.payments.providers.demo.DemoProvider",
    "cash": "apps.payments.providers.cash.CashProvider",
}
_instances: dict[str, PaymentProvider] = {}


class ProviderUnavailable(DomainError):
    default_code = "payment_method_unavailable"


def known_provider_keys() -> list[str]:
    return list(_FACTORIES)


def _configured_keys() -> list[str]:
    keys = []
    for key in settings.PAYMENT_PROVIDERS_ENABLED:
        if key not in _FACTORIES or key in keys:
            continue
        if key == "demo" and not settings.PAYMENT_DEMO_ENABLED:
            continue  # the sandbox simulator is never available when switched off, whatever the list says
        if key == "stripe" and not settings.STRIPE_SECRET_KEY:
            continue  # cannot create sessions without credentials
        keys.append(key)
    return keys


def enabled_provider_keys() -> list[str]:
    """Providers customers may pay with right now: settings gate, demo gate, and the store's own allow-list."""
    from apps.core.cache import cached
    from apps.core.models import StoreSettings

    allowed = cached(
        "catalog",
        ("allowed_checkout_methods",),
        lambda: list(StoreSettings.load().allowed_checkout_methods or []),
        ttl=30,
    )
    keys = _configured_keys()
    return [k for k in keys if k in allowed] if allowed else keys


def get_provider(key: str) -> PaymentProvider:
    """Return the adapter for `key` (used for webhooks, sync, refunds too, so it does not require 'enabled for checkout').

    The sandbox adapter is the exception: it does not exist at all while `PAYMENT_DEMO_ENABLED` is false.
    """
    if key not in _FACTORIES or (key == "demo" and not settings.PAYMENT_DEMO_ENABLED):
        raise ProviderUnavailable("This payment method is not available.", status_code=400)
    if key not in _instances:
        from django.utils.module_loading import import_string

        _instances[key] = import_string(_FACTORIES[key])()
    return _instances[key]


def describe_methods() -> list[dict]:
    out = []
    for key in enabled_provider_keys():
        p = get_provider(key)
        out.append(
            {
                "key": key,
                "label": p.label,
                "description": p.description,
                "is_sandbox": p.sandbox(),
                "offline": p.offline,
            }
        )
    return out


def latest_payment(order):
    """Newest attempt for the order. Uses `order.payments.all()` so a prefetch avoids per-order queries."""
    attempts = list(order.payments.all())
    return max(attempts, key=lambda p: (p.created_at, p.pk)) if attempts else None


def describe_payment(order) -> dict:
    """{status, provider, provider_label, is_sandbox, action|None, failure_message|None, can_retry} for order payloads."""
    payment = latest_payment(order)
    provider_key = payment.provider if payment else order.payment_method
    try:
        provider = get_provider(provider_key)
        label, sandbox = provider.label, (payment.is_sandbox if payment else provider.sandbox())
    except DomainError:
        provider = None
        label = dict(_labels()).get(provider_key, provider_key)
        sandbox = bool(payment and payment.is_sandbox)

    action = None
    if payment and provider and payment.status == "REQUIRES_ACTION":
        action = provider.action_for(payment)
    failure = payment.failure_message if payment and payment.status in ("FAILED",) else None
    status = order.payment_status
    can_retry = (
        order.status == "PENDING"
        and order.payment_method != "cash"
        and status in ("PENDING", "FAILED", "REQUIRES_ACTION")
        and bool(enabled_provider_keys())
    )
    return {
        "status": status,
        "provider": provider_key,
        "provider_label": label,
        "is_sandbox": sandbox,
        "action": action,
        "failure_message": failure or None,
        "can_retry": can_retry,
    }


def _labels():
    from .models import Payment

    return Payment.Provider.choices
