"""Branded order emails (HTML + plain text) built from `templates/emails/order_*`."""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from .services import copy_for, email_recipient, format_money

log = logging.getLogger(__name__)

STATUS_SENT = "sent"
STATUS_SKIPPED_UNVERIFIED = "skipped_unverified"
STATUS_CONSOLE = "console"  # rendered and written by a dev/test backend: NOT delivered to a real inbox
_NON_DELIVERING_BACKENDS = ("console", "locmem", "dummy", "filebased")


def _lines(order):
    items = []
    for item in order.items.all():
        items.append(
            {
                "name": item.product_name,
                "quantity": item.quantity,
                "options": ", ".join(o.option_name for o in item.options.all()),
                "note": item.note,
                "line_total": format_money(item.line_total, order.currency),
            }
        )
    return items


def build_context(notification) -> dict:
    from apps.core.models import StoreSettings

    order = notification.order
    store = StoreSettings.load()
    copy = copy_for(order, notification.kind)
    cur = order.currency
    address = order.delivery_address or {}
    address_lines = [
        str(address[k]) for k in ("recipient_name", "line1", "line2", "city", "postal_code") if address.get(k)
    ]
    method = {"cash": "Pay at pickup / on delivery", "stripe": "Card", "demo": "Sandbox payment (no real money)"}.get(
        order.payment_method, order.payment_method
    )
    return {
        "brand_name": store.brand_name,
        "support_email": store.support_email,
        "order": order,
        "copy": copy,
        "message": notification.body,
        "items": _lines(order),
        "subtotal": format_money(order.subtotal, cur),
        "discount": format_money(order.discount_total, cur) if order.discount_total else "",
        "delivery_fee": format_money(order.delivery_fee, cur) if order.order_type == "DELIVERY" else "",
        "tax": format_money(order.tax_total, cur) if order.tax_total else "",
        "tax_included": order.prices_include_tax,
        "total": format_money(order.total, cur),
        "refunded": format_money(order.refunded_total, cur) if order.refunded_total else "",
        "payment_method": method,
        "payment_status": order.get_payment_status_display(),
        "is_delivery": order.order_type == "DELIVERY",
        "branch": order.branch,
        "address_lines": address_lines,
        "tracking_url": f"{settings.SITE_URL.rstrip('/')}/orders/{order.number}",
        "show_payment_help": notification.kind == "payment_failed",
    }


def render_order_email(notification) -> tuple[str, str, str]:
    ctx = build_context(notification)
    html = render_to_string("emails/order_event.html", ctx)
    text = render_to_string("emails/order_event.txt", ctx)
    return ctx["copy"].subject, text.strip() + "\n", html


def send_order_email(notification) -> str:
    """Render and send. Returns the `email_status` to record. Raises on delivery failure (the task retries)."""
    order = notification.order
    recipient = email_recipient(order)  # re-checked at send time: the address may have changed since it was queued
    if not recipient:
        log.info("email for order %s kind=%s skipped: address not verified", order.number, notification.kind)
        return STATUS_SKIPPED_UNVERIFIED
    subject, text, html = render_order_email(notification)
    message = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [recipient])
    message.attach_alternative(html, "text/html")
    message.send(fail_silently=False)
    if any(token in settings.EMAIL_BACKEND.lower() for token in _NON_DELIVERING_BACKENDS):
        log.info("email for order %s kind=%s: console (not delivered)", order.number, notification.kind)
        return STATUS_CONSOLE
    log.info("email sent for order %s kind=%s", order.number, notification.kind)
    return STATUS_SENT
