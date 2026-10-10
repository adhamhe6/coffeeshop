"""Order lifecycle: transitions, cancellation and (below) checkout.

Every state change goes through `transition_order` / `cancel_order`: the Order row is locked (`select_for_update`),
the move is validated against `apps.orders.state`, an `OrderStatusHistory` row is written, timestamps are set, staff
actions are audited and `notify_order_event` runs after commit. Repeating an already-applied transition is a no-op that
returns the current order; an impossible one raises 409 `invalid_transition`.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import NotFound

from apps.accounts.permissions import staff_role
from apps.core.audit import audit
from apps.core.errors import DomainError
from apps.core.money import q

from . import state
from .models import Order, OrderItem, OrderItemOption, OrderStatusHistory

log = logging.getLogger(__name__)

S = Order.Status
SETTLED_PAYMENT = (Order.PaymentStatus.AUTHORIZED, Order.PaymentStatus.PAID)


# ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def _resolve_actor(actor, *, by_customer: bool = False, system: bool = False):
    """Return (user_or_None, label). `actor` may be a User, a plain label such as 'system', or None."""
    if system or actor is None:
        return None, "system"
    if isinstance(actor, str):
        return None, actor[:160]
    if by_customer:
        return actor, "customer"
    return actor, (getattr(actor, "full_name", "") or getattr(actor, "email", "") or "staff")[:160]


def _notify_on_commit(order: Order, kind: str) -> None:
    """Call `notify_order_event` after the surrounding transaction commits. Never raises into the caller."""

    def _send():
        try:
            from apps.notifications.services import notify_order_event
        except ModuleNotFoundError as exc:
            if exc.name not in ("apps.notifications.services", "apps.notifications"):
                raise
            log.info("notifications module not available; skipped %s for order %s", kind, order.number)
            return
        try:
            notify_order_event(order, kind)
        except Exception:
            log.exception("notify_order_event failed order=%s kind=%s", order.number, kind)

    transaction.on_commit(_send)


def _close_payments_on_commit(order: Order) -> None:
    """Close unsettled payment attempts of a cancelled order once the cancellation is committed (outside our row
    locks - the payment code takes payment -> order locks), so a late customer payment is not accepted."""

    def _close():
        try:
            from apps.payments.services import cancel_open_payments

            cancel_open_payments(order)
        except Exception:
            log.exception("could not close open payments for cancelled order %s", order.number)

    transaction.on_commit(_close)


def blocked_reason(order: Order, to_status: str) -> str | None:
    """Preconditions beyond the pure graph. Online-payment orders cannot be confirmed before payment is authorised."""
    if to_status == S.CONFIRMED and order.payment_method != "cash" and order.payment_status not in SETTLED_PAYMENT:
        return "This order cannot be confirmed until its payment is authorised."
    return None


def _lock_order(order_id) -> Order:
    pk = getattr(order_id, "pk", order_id)
    try:
        return Order.objects.select_for_update(of=("self",)).select_related("branch", "customer").get(pk=pk)
    except Order.DoesNotExist:
        raise NotFound("Order not found.") from None


def _write_history(order, from_status, to_status, user, label, note):
    OrderStatusHistory.objects.create(
        order=order,
        from_status=from_status,
        to_status=to_status,
        actor=user,
        actor_label=label,
        note=(note or "")[:300],
    )


def _audit_if_staff(user, action, order, from_status, to_status, note, request=None):
    if user is not None and staff_role(user) is not None:
        audit(
            user,
            action,
            order,
            summary=f"{order.number}: {from_status} -> {to_status}",
            changes={"from": from_status, "to": to_status, "note": note or ""},
            request=request,
        )


# ── transitions ──────────────────────────────────────────────────────────────────────────────────────────────────────


def _apply_transition(order: Order, to_status: str, *, user, label: str, note: str, by_customer: bool = False) -> Order:
    """Apply a validated transition to an already locked order. Idempotent for repeats."""
    if order.status == to_status:
        return order
    if to_status == S.CANCELLED:
        return _cancel_locked(order, user=user, label=label, reason=note, by_customer=by_customer)

    allowed = state.allowed_transitions(order)
    if to_status not in allowed:
        raise DomainError(
            f"A {order.order_type.lower()} order cannot move from {order.status} to {to_status}.",
            code="invalid_transition",
            status_code=409,
            extra={"from": order.status, "to": to_status, "allowed": allowed},
        )
    reason = blocked_reason(order, to_status)
    if reason:
        raise DomainError(
            reason,
            code="payment_required",
            status_code=409,
            extra={"from": order.status, "to": to_status, "payment_status": order.payment_status},
        )

    previous = order.status
    now = timezone.now()
    order.status = to_status
    fields = ["status", "updated_at"]
    if to_status == S.CONFIRMED:
        order.confirmed_at = now
        fields.append("confirmed_at")
    elif to_status == S.COMPLETED:
        order.completed_at = now
        fields.append("completed_at")
    order.save(update_fields=fields)
    _write_history(order, previous, to_status, user, label, note)
    _audit_if_staff(user, "order.transition", order, previous, to_status, note)
    log.info("order transition number=%s %s->%s actor=%s", order.number, previous, to_status, label)
    kind = state.NOTIFICATION_KIND.get(to_status)
    if kind:
        _notify_on_commit(order, kind)
    return order


def transition_order(order_id, to_status, *, actor=None, note: str = "", system: bool = False) -> Order:
    """Move an order to `to_status` (see module docstring). `order_id` may also be an Order instance.

    `actor` is the staff `User` (or a label string); `system=True` records the change as made by the system (payment
    handlers, expiry). Cancellation is routed through the same code as `cancel_order` (stock restored, coupon voided).
    Completing a cash order does NOT mark the cash as collected - that is `payments.services.mark_cash_collected`.
    """
    to_status = str(to_status)
    if to_status not in Order.Status.values:
        raise DomainError("Unknown order status.", code="invalid_status", fields={"status": ["Invalid choice."]})
    user, label = _resolve_actor(actor, system=system)
    with transaction.atomic():
        order = _lock_order(order_id)
        return _apply_transition(order, to_status, user=user, label=label, note=note)


# ── cancellation ─────────────────────────────────────────────────────────────────────────────────────────────────────


def _cancel_locked(order: Order, *, user, label: str, reason: str, by_customer: bool = False) -> Order:
    if order.status == S.CANCELLED:
        return order
    if order.status not in state.CANCELLABLE:
        raise DomainError(
            "This order is already completed and cannot be cancelled.",
            code="invalid_transition",
            status_code=409,
            extra={"from": order.status, "to": S.CANCELLED, "allowed": []},
        )
    if by_customer and order.status != S.PENDING:
        raise DomainError(
            "This order has already been accepted by the store and can no longer be cancelled online. "
            "Please contact the store.",
            code="invalid_transition",
            status_code=409,
            extra={"from": order.status, "to": S.CANCELLED, "allowed": []},
        )
    from apps.inventory.services import restore_stock_for_order
    from apps.promotions.services import void_redemption

    previous = order.status
    reason = (reason or "").strip()[:200]
    # Lock order everywhere: order -> coupon -> stock (checkout takes coupon -> branch -> stock), so no deadlocks.
    void_redemption(order)
    restore_stock_for_order(order, reason=f"Order {order.number} cancelled")
    order.status = S.CANCELLED
    order.cancelled_at = timezone.now()
    order.cancel_reason = reason
    order.save(update_fields=["status", "cancelled_at", "cancel_reason", "updated_at"])
    _write_history(order, previous, S.CANCELLED, user, label, reason)
    _audit_if_staff(user, "order.cancel", order, previous, S.CANCELLED, reason)
    log.info("order cancelled number=%s from=%s actor=%s reason=%r", order.number, previous, label, reason)
    _notify_on_commit(order, "order_cancelled")
    _close_payments_on_commit(order)
    return order


def cancel_order(order_id, *, actor=None, reason: str = "", by_customer: bool = False) -> Order:
    """Cancel an order: restore stock (exactly once), void the coupon redemption, record history, notify.

    Does not refund anything - a refund is a separate, verified provider operation (payments.services.refund_payment).
    `by_customer=True` additionally requires the order to still be PENDING. Cancelling a cancelled order is a no-op;
    cancelling a completed one raises 409 `invalid_transition`.
    """
    user, label = _resolve_actor(actor, by_customer=by_customer)
    with transaction.atomic():
        order = _lock_order(order_id)
        return _cancel_locked(order, user=user, label=label, reason=reason, by_customer=by_customer)


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# Checkout
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")
NUMBER_RETRIES = 5
UNPAID_STATUSES = (Order.PaymentStatus.PENDING, Order.PaymentStatus.REQUIRES_ACTION, Order.PaymentStatus.FAILED)
SETTLED_OR_REFUNDED = (
    Order.PaymentStatus.AUTHORIZED,
    Order.PaymentStatus.PAID,
    Order.PaymentStatus.PARTIALLY_REFUNDED,
    Order.PaymentStatus.REFUNDED,
)


@dataclass
class PlacedOrder:
    order: Order
    created: bool


def is_valid_idempotency_key(key) -> bool:
    return isinstance(key, str) and bool(IDEMPOTENCY_KEY_RE.match(key))


def _replay(user, key) -> Order | None:
    return Order.objects.filter(customer=user, idempotency_key=key).first()


def lock_customer(user) -> None:
    """Serialise the per-customer open-order cap: checkout and a switch to cash both take this row lock first.

    `no_key` (FOR NO KEY UPDATE) does not conflict with the KEY SHARE lock other transactions take on the user row when
    they insert rows that reference it (notifications, audit log...), so this cannot deadlock with them.
    """
    from apps.accounts.models import User

    User.objects.select_for_update(no_key=True).only("id").get(pk=user.pk)


def assert_cash_capacity(user, *, exclude_order_id=None) -> None:
    """409 `too_many_open_cash_orders` when the customer already holds the maximum of unconfirmed cash orders.

    Call it while holding `lock_customer(user)`, inside the transaction that creates / switches the order, so
    concurrent attempts cannot all pass the check.
    """
    limit = settings.MAX_OPEN_CASH_ORDERS_PER_CUSTOMER
    qs = Order.objects.filter(customer=user, payment_method="cash", status=S.PENDING)
    if exclude_order_id is not None:
        qs = qs.exclude(pk=exclude_order_id)
    if qs.count() >= limit:
        raise DomainError(
            f"You already have {limit} cash orders waiting for the store to confirm them. "
            "Wait for the store to confirm or cancel one, or pay online.",
            code="too_many_open_cash_orders",
            status_code=409,
            extra={"limit": limit},
        )


def place_order(user, *, payload: dict, idempotency_key: str) -> PlacedOrder:
    """Create an order from the customer's cart. Idempotent per (customer, idempotency_key).

    `payload`: branch_id, order_type, address_id?, requested_for?, coupon_code?, payment_method, customer_notes?,
    accept_terms, expected_total?, phone?. Everything price-like is recomputed from the database inside one
    transaction (cart row locked -> coupon -> branch -> stock); the cart is cleared in the same transaction.
    Payment is NOT started here - call `begin_payment(order)` after this returns (outside any transaction).
    """
    if not is_valid_idempotency_key(idempotency_key):
        raise DomainError(
            "Idempotency-Key must be 8-64 characters (letters, digits, '-', '_', '.', ':').",
            code="idempotency_key_invalid",
        )
    existing = _replay(user, idempotency_key)
    if existing is not None:
        return PlacedOrder(existing, False)
    if payload.get("accept_terms") is not True:
        raise DomainError(
            "You must accept the terms to place an order.",
            code="terms_not_accepted",
            fields={"accept_terms": ["You must accept the terms."]},
        )
    from apps.payments.registry import enabled_provider_keys

    enabled = enabled_provider_keys()
    method = (payload.get("payment_method") or "").strip()
    if method not in enabled:
        raise DomainError(
            "That payment method is not available.",
            code="payment_method_unavailable",
            fields={"payment_method": ["Choose one of the available payment methods."]},
        )
    try:
        with transaction.atomic():
            return _place_order_atomic(user, payload, idempotency_key, method, enabled)
    except IntegrityError:
        # A concurrent request with the same key won the race for the unique (customer, key) constraint.
        existing = _replay(user, idempotency_key)
        if existing is not None:
            return PlacedOrder(existing, False)
        raise


def _price_changed_error(evaluation) -> DomainError:
    from apps.cart.selectors import preview_payload
    from apps.cart.serializers import CartPreviewSerializer

    return DomainError(
        "Prices changed since you last reviewed your order. Please review the new total.",
        code="price_changed",
        status_code=409,
        extra={"preview": CartPreviewSerializer(preview_payload(evaluation)).data},
    )


def _place_order_atomic(user, payload, idempotency_key, method, enabled) -> PlacedOrder:
    from apps.accounts.models import Address
    from apps.branches.models import Branch
    from apps.cart.evaluation import evaluate_checkout
    from apps.cart.models import Cart
    from apps.cart.pricing import CouponRejected, evaluate_coupon
    from apps.cart.services import lines_from_items, load_items, touch
    from apps.core.models import StoreSettings
    from apps.inventory.services import deduct_stock_for_order
    from apps.promotions.models import Coupon, CouponRedemption

    lock_customer(user)  # lock order: customer -> cart -> coupon -> branch -> stock
    cart = Cart.objects.select_for_update().filter(user=user).first()
    existing = _replay(user, idempotency_key)  # the winner of a race has committed by the time we hold the cart lock
    if existing is not None:
        return PlacedOrder(existing, False)
    if cart is None:
        raise DomainError("Your cart is empty.", code="cart_empty")

    now = timezone.now()
    store = StoreSettings.load()
    order_type = payload["order_type"]
    branch = Branch.objects.prefetch_related("hours", "closures").filter(pk=payload.get("branch_id")).first()
    if branch is None:
        raise DomainError("Branch not found.", code="not_found", status_code=404)
    address = None
    if order_type == Order.Type.DELIVERY and payload.get("address_id"):
        address = (
            Address.objects.select_related("zone").filter(pk=payload["address_id"], user=user, is_deleted=False).first()
        )
        if address is None:
            raise DomainError("Address not found.", code="not_found", status_code=404)

    items = load_items(cart)
    evaluation = evaluate_checkout(
        user=user,
        lines=lines_from_items(items),
        branch=branch,
        order_type=order_type,
        address=address,
        coupon_code=payload.get("coupon_code") or "",
        requested_for=payload.get("requested_for"),
        now=now,
        store=store,
    )
    evaluation.raise_first_blocker()
    breakdown = evaluation.breakdown

    expected = payload.get("expected_total")
    if expected is not None and q(expected) != breakdown.total:
        raise _price_changed_error(evaluation)

    # Lock order: coupon -> branch -> stock (cancellation uses order -> coupon -> stock).
    coupon = None
    if breakdown.applied_coupon is not None:
        coupon = (
            Coupon.objects.select_for_update()
            .prefetch_related("categories", "products")
            .get(pk=breakdown.applied_coupon.pk)
        )
        try:
            rechecked = evaluate_coupon(coupon, list(breakdown.lines), user=user, now=now)
        except CouponRejected as exc:
            raise DomainError(
                exc.message,
                code=exc.code,
                status_code=409 if exc.code == "exhausted" else 400,
                fields={"coupon_code": [exc.message]},
            ) from None
        if rechecked.discount != breakdown.discount_total:
            raise _price_changed_error(evaluation)

    if breakdown.total <= 0 and "cash" in enabled:
        method = "cash"  # nothing to charge online; the payment step is skipped for free orders
    if method == "cash":
        assert_cash_capacity(user)

    order = _create_order_row(
        user=user,
        branch=branch,
        evaluation=evaluation,
        payload=payload,
        address=address,
        method=method,
        key=idempotency_key,
        now=now,
        store=store,
        coupon=coupon,
    )
    deduct_stock_for_order(order)  # raises StockShortage (409 out_of_stock) -> whole transaction rolls back

    if coupon is not None:
        Coupon.objects.filter(pk=coupon.pk).update(times_redeemed=F("times_redeemed") + 1)
        CouponRedemption.objects.create(coupon=coupon, user=user, order=order, discount_amount=breakdown.discount_total)

    cart.items.all().delete()
    if cart.branch_id != branch.id:
        cart.branch = branch
        cart.save(update_fields=["branch", "updated_at"])
    else:
        touch(cart.pk)
    _notify_on_commit(order, "order_placed")
    log.info(
        "order placed number=%s customer=%s branch=%s type=%s total=%s method=%s coupon=%s",
        order.number,
        user.pk,
        branch.code,
        order_type,
        order.total,
        method,
        coupon.code if coupon else "-",
    )
    return PlacedOrder(order, True)


def _next_number(branch, local_date, attempt: int) -> str:
    prefix = f"{branch.code}-{local_date:%y%m%d}-"
    used = Order.objects.filter(number__startswith=prefix).count()
    return f"{prefix}{used + 1 + attempt:04d}"


def _create_order_row(*, user, branch, evaluation, payload, address, method, key, now, store, coupon) -> Order:
    from apps.branches.models import Branch

    b = evaluation.breakdown
    # Serialise number assignment per branch (row lock held until commit; the number column is unique as a backstop).
    Branch.objects.select_for_update().get(pk=branch.pk)
    local_date = now.astimezone(branch.tz).date()

    snapshot = None
    zone_name = ""
    phone = (payload.get("phone") or "").strip()
    if address is not None:
        snapshot = {
            "label": address.label,
            "recipient_name": address.recipient_name,
            "phone": address.phone,
            "line1": address.line1,
            "line2": address.line2,
            "city": address.city,
            "postal_code": address.postal_code,
            "instructions": address.instructions,
            "zone": address.zone.name if address.zone else "",
        }
        zone_name = address.zone.name if address.zone else ""
        phone = phone or address.phone
    phone = phone or user.phone

    last_error = None
    for attempt in range(NUMBER_RETRIES):
        number = _next_number(branch, local_date, attempt)
        try:
            with transaction.atomic():  # savepoint: a number collision must not poison the outer transaction
                order = Order.objects.create(
                    number=number,
                    customer=user,
                    branch=branch,
                    order_type=evaluation.order_type,
                    status=Order.Status.PENDING,
                    payment_status=Order.PaymentStatus.PENDING,
                    payment_method=method,
                    currency=b.currency,
                    subtotal=b.subtotal,
                    discount_total=b.discount_total,
                    delivery_fee=b.delivery_fee,
                    tax_total=b.tax_total,
                    tax_rate=b.tax_rate,
                    prices_include_tax=b.prices_include_tax,
                    total=b.total,
                    coupon=coupon,
                    coupon_code=coupon.code if coupon else "",
                    customer_name=user.full_name,
                    customer_email=user.email,
                    customer_phone=phone[:30],
                    delivery_address=snapshot,
                    delivery_zone_name=zone_name,
                    requested_for=evaluation.requested_for,
                    estimated_ready_at=evaluation.estimated_ready_at,
                    customer_notes=(payload.get("customer_notes") or "").strip()[:300],
                    terms_accepted_at=now,
                    idempotency_key=key,
                    placed_at=now,
                )
            break
        except IntegrityError as exc:
            if "idempotency" in str(exc) or "order_idempotency_per_customer" in str(exc):
                raise
            last_error = exc
    else:
        raise last_error  # pragma: no cover - would need 5 consecutive collisions under the branch lock

    order_items = [
        OrderItem(
            order=order,
            product=line.product,
            product_name=line.product.name,
            sku=line.product.sku,
            category_name=line.product.category.name,
            base_price=line.base_price,
            unit_price=line.unit_price,
            quantity=line.quantity,
            line_total=line.line_total,
            discount_amount=line.discount,
            note=line.note,
        )
        for line in b.lines
    ]
    OrderItem.objects.bulk_create(order_items)
    OrderItemOption.objects.bulk_create(
        [
            OrderItemOption(
                item=item,
                option=opt,
                group_name=opt.group.display_name,
                option_name=opt.name,
                price_delta=q(opt.price_delta),
            )
            for item, line in zip(order_items, b.lines, strict=True)
            for opt in line.options
        ]
    )
    _write_history(order, "", Order.Status.PENDING, user, "customer", "Order placed")
    return order


# ── payment hand-off ─────────────────────────────────────────────────────────────────────────────────────────────────


def payment_urls(order: Order) -> dict:
    base = settings.SITE_URL.rstrip("/")
    return {
        "return_url": f"{base}/orders/{order.number}/confirmation",
        "cancel_url": f"{base}/orders/{order.number}?payment=cancelled",
    }


def begin_payment(order: Order, method: str | None = None, *, swallow_errors: bool = True) -> dict:
    """Start (or reuse) a payment attempt for `order` and return the payment summary for the API payload.

    Runs outside any transaction. With `swallow_errors` (checkout) a provider failure keeps the order PENDING and is
    reported as `payment.error` so the customer can retry via `orders/{number}/pay/`; otherwise it propagates.
    Free orders skip the payment step.
    """
    from apps.payments.registry import describe_payment
    from apps.payments.services import start_payment

    method = method or order.payment_method
    error = None
    if order.total > 0:
        try:
            start_payment(order, method, **payment_urls(order))
        except DomainError as exc:
            if not swallow_errors:
                raise
            error = {"code": str(exc.detail.code), "message": str(exc.detail)}
            log.warning("payment start failed order=%s code=%s", order.number, error["code"])
        except Exception:
            if not swallow_errors:
                raise
            log.exception("payment provider error starting payment for order %s", order.number)
            error = {
                "code": "payment_start_failed",
                "message": "We could not reach the payment provider. Please retry.",
            }
    order.refresh_from_db()
    summary = describe_payment(order)
    summary["error"] = error
    return summary


def pay_order(order: Order, method: str | None = None) -> dict:
    """Customer retry/switch of payment for their own PENDING order. Returns the payment summary."""
    if order.status != Order.Status.PENDING:
        raise DomainError("This order can no longer be paid.", code="order_not_payable", status_code=409)
    if order.payment_status in SETTLED_OR_REFUNDED:
        raise DomainError("This order has already been paid.", code="already_paid", status_code=409)
    method = (method or order.payment_method).strip()
    if method != order.payment_method:
        from apps.payments.registry import enabled_provider_keys

        if method not in enabled_provider_keys():
            raise DomainError(
                "That payment method is not available.",
                code="payment_method_unavailable",
                fields={"payment_method": ["Choose one of the available payment methods."]},
            )
        with transaction.atomic():
            if method == "cash":  # switching to cash counts against the open-cash-order cap (same lock as checkout)
                lock_customer(order.customer)
                assert_cash_capacity(order.customer, exclude_order_id=order.pk)
            updated = Order.objects.filter(pk=order.pk, status=Order.Status.PENDING).update(
                payment_method=method, updated_at=timezone.now()
            )
        if not updated:
            raise DomainError("This order can no longer be paid.", code="order_not_payable", status_code=409)
        order.payment_method = method
    return begin_payment(order, method, swallow_errors=False)


def refund_hint(order: Order) -> dict:
    """What a customer should expect about money after cancelling (cancelling never refunds by itself)."""
    status = order.payment_status
    if status in (Order.PaymentStatus.AUTHORIZED, Order.PaymentStatus.PAID):
        return {
            "refund_status": "review_pending",
            "refund_message": "Your payment was received. Our team will review the refund and email you.",
        }
    if status == Order.PaymentStatus.PARTIALLY_REFUNDED:
        return {"refund_status": "partially_refunded", "refund_message": "Part of your payment was already refunded."}
    if status == Order.PaymentStatus.REFUNDED:
        return {"refund_status": "refunded", "refund_message": "Your payment was refunded."}
    return {"refund_status": "not_applicable", "refund_message": "You were not charged for this order."}


def customer_cancel(order: Order, reason: str = "") -> Order:
    return cancel_order(order.pk, actor=order.customer, reason=reason or "Cancelled by customer", by_customer=True)


# ── reorder ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def reorder(user, order: Order):
    """Add the still-valid lines of a past order to the customer's cart. Returns (cart, skipped[{name, reason, message}])."""
    from apps.cart import services as cart_services

    cart = cart_services.get_cart_for_user(user)
    skipped = []
    for item in order.items.select_related("product").prefetch_related("options"):
        if item.product_id is None:
            skipped.append(
                {"name": item.product_name, "reason": "product_removed", "message": "No longer on the menu."}
            )
            continue
        option_ids = [o.option_id for o in item.options.all()]
        if any(i is None for i in option_ids):
            skipped.append(
                {"name": item.product_name, "reason": "option_removed", "message": "An option is no longer offered."}
            )
            continue
        try:
            product = cart_services.get_product(item.product_id)
            cart_services.add_item(cart, product, option_ids, item.quantity, item.note)
        except DomainError as exc:
            skipped.append({"name": item.product_name, "reason": str(exc.detail.code), "message": str(exc.detail)})
    return cart, skipped
