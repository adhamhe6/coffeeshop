"""Order notifications: an in-app `Notification` (committed with the business change) plus a queued email.

`notify_order_event` never raises into callers: a notification problem must not roll back or fail an order/payment
change. The email is sent by Celery after the surrounding transaction commits, retries on failure, and records its
outcome in `Notification.email_status` (queued -> sent | console | failed | skipped | skipped_unverified).

Email goes only to a customer whose address is verified (`accounts.services.can_email`): anyone can register with
somebody else's address, and we must not mail that third party. The in-app notification is always created. The email
is addressed to the customer's *current verified* address, not the one copied onto the order at checkout.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.db import transaction

from .models import Notification

log = logging.getLogger(__name__)

KINDS = (
    "order_placed",
    "payment_confirmed",
    "payment_failed",
    "order_confirmed",
    "order_preparing",
    "order_ready",
    "order_out_for_delivery",
    "order_completed",
    "order_cancelled",
    "refund_updated",
)
# In-app only: too chatty for email (every kitchen step would otherwise send a message).
NO_EMAIL_KINDS = frozenset({"order_preparing"})

EMAIL_QUEUED = "queued"
EMAIL_SKIPPED = "skipped"
EMAIL_SKIPPED_UNVERIFIED = "skipped_unverified"  # the in-app notification exists; the address is not verified (S9)


@dataclass(frozen=True)
class Copy:
    title: str  # <= 120
    body: str  # <= 300
    subject: str
    headline: str


def format_money(amount, currency: str) -> str:
    symbols = {"USD": "$", "EUR": "€", "GBP": "£"}
    value = f"{amount:,.2f}"
    symbol = symbols.get(currency.upper())
    return f"{symbol}{value}" if symbol else f"{value} {currency.upper()}"


def copy_for(order, kind: str) -> Copy:
    """Customer-facing wording per event, tailored to pickup vs delivery. Plain text, no personal data beyond the order."""
    n = order.number
    delivery = order.order_type == "DELIVERY"
    branch = order.branch.name if order.branch_id else "the shop"
    total = format_money(order.total, order.currency)
    online = order.payment_method != "cash"

    if kind == "order_placed":
        if online and order.payment_status not in ("PAID", "AUTHORIZED"):
            body = f"We've received your {'delivery' if delivery else 'pickup'} order. It is confirmed once your payment of {total} goes through."
        elif delivery:
            body = f"We've received your delivery order from {branch}. You'll pay {total} on delivery."
        else:
            body = f"We've received your pickup order at {branch}. You'll pay {total} when you collect it."
        return Copy(f"Order {n} received", body, f"We received your order {n}", "Thanks, we've got your order")
    if kind == "payment_confirmed":
        return Copy(
            "Payment received",
            f"Thanks! We've received your payment of {total} for order {n}.",
            f"Payment received for order {n}",
            "Payment received",
        )
    if kind == "payment_failed":
        return Copy(
            "Payment didn't go through",
            f"Your payment for order {n} was not completed and you haven't been charged for it. You can try again from your order page.",
            f"Payment problem with order {n}",
            "Your payment didn't go through",
        )
    if kind == "order_confirmed":
        action = "start preparing it for delivery" if delivery else "start preparing it"
        return Copy(
            f"Order {n} confirmed",
            f"{branch} has accepted your order and will {action} shortly.",
            f"Order {n} confirmed",
            "Your order is confirmed",
        )
    if kind == "order_preparing":
        return Copy(
            "We're preparing your order",
            f"Order {n} is being prepared at {branch}.",
            f"Order {n} is being prepared",
            "We're preparing your order",
        )
    if kind == "order_ready":
        return Copy(
            "Ready for pickup",
            f"Order {n} is ready at {branch}. Tell the team your order number when you arrive.",
            f"Order {n} is ready for pickup",
            "Your order is ready for pickup",
        )
    if kind == "order_out_for_delivery":
        return Copy(
            "On its way", f"Order {n} is out for delivery.", f"Order {n} is on its way", "Your order is on its way"
        )
    if kind == "order_completed":
        if delivery:
            return Copy(
                f"Order {n} delivered",
                "Your order has been delivered. Enjoy!",
                f"Order {n} delivered",
                "Delivered. Enjoy!",
            )
        return Copy(
            f"Order {n} picked up", "Thanks for stopping by. Enjoy!", f"Order {n} picked up", "Picked up. Enjoy!"
        )
    if kind == "order_cancelled":
        return Copy(
            f"Order {n} cancelled",
            "Your order has been cancelled. If you already paid online, any refund is handled separately and you'll be notified when it is issued.",
            f"Order {n} cancelled",
            "Your order was cancelled",
        )
    if kind == "refund_updated":
        refunded = format_money(order.refunded_total, order.currency)
        if order.payment_method == "cash":
            body = f"A cash refund for order {n} has been recorded. Total refunded: {refunded}."
        else:
            body = f"A refund for order {n} has been issued. Total refunded: {refunded}. It can take a few business days to show on your statement."
        return Copy(
            "Refund update",
            body,
            f"Refund update for order {n}",
            "Your refund is on its way" if order.payment_method != "cash" else "Your refund was recorded",
        )
    raise ValueError(f"unknown notification kind {kind!r}")


def email_recipient(order) -> str:
    """The address order email goes to: the customer's current address, only when it is verified; else ''."""
    from apps.accounts.services import can_email

    customer = order.customer
    return customer.email if can_email(customer) else ""


def email_status_for(order, kind: str) -> str:
    if kind in NO_EMAIL_KINDS:
        return EMAIL_SKIPPED
    return EMAIL_QUEUED if email_recipient(order) else EMAIL_SKIPPED_UNVERIFIED


def notify_order_event(order, kind: str) -> None:
    """Create the in-app notification and, after commit, enqueue the email. Never raises."""
    try:
        if kind not in KINDS:
            raise ValueError(f"unknown notification kind {kind!r}")
        copy = copy_for(order, kind)
        email_status = email_status_for(order, kind)
        with transaction.atomic():  # savepoint: a failure here must not poison the caller's transaction
            notification = Notification.objects.create(
                user_id=order.customer_id,
                order=order,
                kind=kind,
                title=copy.title[:120],
                body=copy.body[:300],
                email_status=email_status,
            )
        if email_status == EMAIL_QUEUED:
            transaction.on_commit(lambda: _enqueue_email(notification.pk))
    except Exception:  # noqa: BLE001
        log.exception("could not create notification kind=%s order=%s", kind, getattr(order, "number", "?"))


def _enqueue_email(notification_id: int) -> None:
    from .tasks import send_notification_email

    try:
        send_notification_email.delay(notification_id)
    except Exception:  # noqa: BLE001 - broker down: record it, never break the caller
        log.exception("could not enqueue email for notification %s", notification_id)
        Notification.objects.filter(pk=notification_id).update(email_status="failed")
