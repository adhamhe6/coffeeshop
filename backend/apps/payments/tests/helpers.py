"""ORM helpers for payment/admin-order tests. They build orders that satisfy every model constraint."""

from __future__ import annotations

import itertools
import uuid
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.core.money import q
from apps.orders.models import Order, OrderItem, OrderItemOption, OrderStatusHistory
from apps.payments.models import Payment, PaymentEvent, Refund
from tests.factories import make_address, make_branch, make_user, make_zone

_seq = itertools.count(1)


def make_order(
    customer=None,
    branch=None,
    *,
    order_type: str = "PICKUP",
    payment_method: str = "demo",
    status: str = "PENDING",
    payment_status: str = "PENDING",
    items=None,
    discount: str = "0.00",
    tax: str = "0.00",
    delivery_fee: str | None = None,
    placed_ago_minutes: int = 0,
    currency: str = "USD",
    **extra,
) -> Order:
    """items: iterable of (name, unit_price, quantity[, [(group, option, delta), ...]]); default = 2 x $5.00 coffee."""
    customer = customer or make_user()
    branch = branch or make_branch()
    items = list(items or [("Flat white", "5.00", 2)])
    fee = Decimal(delivery_fee if delivery_fee is not None else ("2.00" if order_type == "DELIVERY" else "0.00"))
    if order_type != "DELIVERY":
        fee = Decimal("0.00")
    lines = []
    for spec in items:
        name, price, qty = spec[0], Decimal(spec[1]), int(spec[2])
        opts = spec[3] if len(spec) > 3 else []
        unit = price + sum((Decimal(d) for _, _, d in opts), Decimal("0"))
        lines.append((name, price, unit, qty, opts, q(unit * qty)))
    subtotal = q(sum((ln[5] for ln in lines), Decimal("0")))
    discount_d, tax_d = q(discount), q(tax)
    total = q(subtotal - discount_d + fee + tax_d)
    n = next(_seq)
    placed_at = timezone.now() - timedelta(minutes=placed_ago_minutes)
    address = None
    if order_type == "DELIVERY":
        zone = make_zone(branch=branch)
        addr = make_address(customer, zone)
        address = {"recipient_name": addr.recipient_name, "line1": addr.line1, "city": addr.city, "postal_code": ""}
    order = Order.objects.create(
        number=extra.pop("number", f"{branch.code}-260101-{n:04d}"),
        customer=customer,
        branch=branch,
        order_type=order_type,
        status=status,
        payment_status=payment_status,
        payment_method=payment_method,
        currency=currency,
        subtotal=subtotal,
        discount_total=discount_d,
        delivery_fee=fee,
        tax_total=tax_d,
        total=total,
        customer_name=extra.pop("customer_name", customer.full_name),
        customer_email=extra.pop("customer_email", customer.email),
        customer_phone=extra.pop("customer_phone", "+15550100"),
        delivery_address=address,
        idempotency_key=extra.pop("idempotency_key", uuid.uuid4().hex),
        placed_at=placed_at,
        **extra,
    )
    for name, price, unit, qty, opts, line_total in lines:
        item = OrderItem.objects.create(
            order=order,
            product_name=name,
            sku=f"SKU{n}",
            base_price=price,
            unit_price=unit,
            quantity=qty,
            line_total=line_total,
        )
        for group, option, delta in opts:
            OrderItemOption.objects.create(item=item, group_name=group, option_name=option, price_delta=Decimal(delta))
    OrderStatusHistory.objects.create(order=order, from_status="", to_status="PENDING", actor_label="customer")
    return order


def make_payment(
    order: Order,
    provider: str = "demo",
    status: str = "PENDING",
    *,
    reference: str | None = None,
    sandbox: bool | None = None,
    paid: bool | None = None,
    **extra,
) -> Payment:
    n = order.payments.count() + 1
    if reference is None:
        reference = "" if provider == "cash" else f"{provider}_{uuid.uuid4().hex[:16]}"
    settled = status in ("PAID", "AUTHORIZED", "PARTIALLY_REFUNDED", "REFUNDED")
    paid = settled if paid is None else paid
    return Payment.objects.create(
        order=order,
        provider=provider,
        status=status,
        amount=extra.pop("amount", order.total),
        currency=order.currency,
        reference=reference,
        idempotency_key=extra.pop("idempotency_key", f"pay-{order.number}-{n}-{uuid.uuid4().hex[:6]}"),
        is_sandbox=provider == "demo" if sandbox is None else sandbox,
        paid_at=timezone.now() if paid else None,
        **extra,
    )


def settle(order: Order, provider: str = "demo", **extra) -> Payment:
    """A PAID payment mirrored onto the order."""
    payment = make_payment(order, provider, "PAID", **extra)
    order.payment_status = "PAID"
    order.save(update_fields=["payment_status"])
    return payment


def make_refund(payment: Payment, amount: str, status: str = "SUCCEEDED", **extra) -> Refund:
    return Refund.objects.create(
        payment=payment,
        amount=Decimal(amount),
        status=status,
        idempotency_key=extra.pop("idempotency_key", f"r-{uuid.uuid4().hex}"),
        **extra,
    )


def event_count(provider: str | None = None) -> int:
    qs = PaymentEvent.objects.all()
    return qs.filter(provider=provider).count() if provider else qs.count()


# ── Stripe test doubles (real signatures, no network) ───────────────────────────────────────────────────────────────
import hashlib  # noqa: E402
import hmac  # noqa: E402
import json  # noqa: E402
import time  # noqa: E402

from django.conf import settings  # noqa: E402

from apps.core.money import q as _q  # noqa: E402
from apps.payments.currency import to_minor  # noqa: E402


def stripe_signature(body: bytes, *, secret: str | None = None, timestamp: int | None = None) -> str:
    """A genuine `Stripe-Signature` header: t=<ts>,v1=HMAC-SHA256(secret, "<ts>.<body>")."""
    ts = int(time.time()) if timestamp is None else timestamp
    secret = settings.STRIPE_WEBHOOK_SECRET if secret is None else secret
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


def stripe_event(event_type: str, obj: dict, *, event_id: str | None = None) -> dict:
    return {
        "id": event_id or f"evt_{uuid.uuid4().hex[:20]}",
        "object": "event",
        "type": event_type,
        "created": int(time.time()),
        "data": {"object": obj},
    }


def session_object(
    payment: Payment,
    *,
    payment_status: str = "paid",
    status: str = "complete",
    amount=None,
    currency=None,
    intent: str | None = "pi_test_123",
) -> dict:
    cur = (currency or payment.currency).lower()
    amt = payment.amount if amount is None else _q(amount)
    return {
        "id": payment.reference,
        "object": "checkout.session",
        "mode": "payment",
        "payment_status": payment_status,
        "status": status,
        "amount_total": to_minor(amt, cur),
        "currency": cur,
        "payment_intent": intent,
        "client_reference_id": payment.order.number,
        "metadata": {"payment_id": str(payment.pk), "order_number": payment.order.number},
        "customer_details": {"email": "secret-person@example.com", "name": "Should Not Be Stored"},
    }


def signed_webhook(event: dict, *, secret: str | None = None, timestamp: int | None = None) -> tuple[bytes, dict]:
    body = json.dumps(event).encode()
    return body, {"HTTP_STRIPE_SIGNATURE": stripe_signature(body, secret=secret, timestamp=timestamp)}


def post_stripe_webhook(client, event: dict, **kw):
    body, headers = signed_webhook(event, **kw)
    return client.generic("POST", "/api/v1/payments/webhooks/stripe/", body, content_type="application/json", **headers)


# ── provider events ─────────────────────────────────────────────────────────────────────────────────────────────────
def demo_event(payment: Payment, outcome: str = "success", **overrides):
    """A verified, normalised demo event built through the real signing + verification path."""
    from dataclasses import replace

    from apps.payments.providers.demo import DemoProvider, build_signed_event

    body, headers = build_signed_event(payment, outcome)
    event = DemoProvider().verify_webhook(body, headers)
    return replace(event, **overrides) if overrides else event


def block_stripe_network(monkeypatch):
    """Tests may only reach Stripe through explicit mocks; anything else fails like a connection error."""
    import stripe

    def blocked(*args, **kwargs):
        raise stripe.APIConnectionError("network access is blocked in tests")

    for resource, method in (
        (stripe.checkout.Session, "create"),
        (stripe.checkout.Session, "retrieve"),
        (stripe.checkout.Session, "expire"),
        (stripe.Refund, "create"),
    ):
        monkeypatch.setattr(resource, method, blocked)
