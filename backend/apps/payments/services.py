"""Payment business rules: starting attempts, applying provider events, refunds and cash collection.

Invariants (see docs/implementation-plan.md §5 "Payment status"):
- Payments become PAID/FAILED/CANCELLED **only** from a verified provider event or provider API retrieval.
- Every provider event is recorded exactly once (`PaymentEvent` unique on provider+event_id); replays are no-ops.
- Lock order is always PaymentEvent insert -> Payment row -> Order row -> Refund row.
- Provider network calls (create/refund) never run inside the row locks that guard the invariants.
- `Order.payment_status` / `Order.refunded_total` are *derived* from the order's payments by `sync_order_payment_status`.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.core.audit import audit
from apps.core.errors import Conflict, DomainError
from apps.core.money import ZERO, q
from apps.notifications.services import notify_order_event
from apps.orders.models import Order

from .models import Payment, PaymentEvent, Refund
from .providers import base as pb
from .providers.base import ProviderError, ProviderEvent
from .registry import enabled_provider_keys, get_provider

log = logging.getLogger(__name__)

SETTLED = ("AUTHORIZED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED")
REFUNDABLE = ("PAID", "PARTIALLY_REFUNDED", "REFUNDED")
LIVE = ("PENDING", "REQUIRES_ACTION")
DUPLICATE_CHARGE = "duplicate_charge"
AMOUNT_MISMATCH = "amount_mismatch"
REUSE_MARGIN = timedelta(minutes=2)
IN_FLIGHT_POLLS = 40
IN_FLIGHT_POLL_SECONDS = 0.25

P = Payment.Status
R = Refund.Status


@dataclass
class PaymentStart:
    payment: Payment
    action: dict  # {"type": "redirect", "url": ...} | {"type": "none"}


# ── order mirror ─────────────────────────────────────────────────────────────
def sync_order_payment_status(order: Order) -> None:
    """Recompute `order.payment_status` and `order.refunded_total` from its payments (caller holds the order lock)."""
    payments = list(Payment.objects.filter(order=order))
    settled = [p for p in payments if p.status in SETTLED]
    if settled:
        status = settled[0].status
        refunded = sum((p.refunded_total for p in settled), ZERO)
    else:
        refunded = ZERO
        latest = max(payments, key=lambda p: (p.created_at, p.pk), default=None)
        status = {"REQUIRES_ACTION": "REQUIRES_ACTION", "FAILED": "FAILED"}.get(
            latest.status if latest else "", "PENDING"
        )
    if order.payment_status != status or order.refunded_total != refunded:
        order.payment_status = status
        order.refunded_total = refunded
        order.save(update_fields=["payment_status", "refunded_total", "updated_at"])


def _lock_order_and_payments(order_id: int) -> tuple[Order, list[Payment]]:
    """Lock all of an order's payments (by id) and then the order itself: the same Payment -> Order lock order that
    event handling uses, so the two can never deadlock. Returns attempts newest first."""
    ids = list(Payment.objects.filter(order_id=order_id).order_by("pk").values_list("pk", flat=True))
    list(Payment.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    order = Order.objects.select_for_update().get(pk=order_id)
    attempts = list(Payment.objects.filter(order_id=order_id).order_by("-created_at", "-id"))
    return order, attempts


def _lock_payment_then_order(payment_id: int) -> tuple[Payment, Order]:
    payment = Payment.objects.select_for_update().get(pk=payment_id)
    order = Order.objects.select_for_update().get(pk=payment.order_id)
    return payment, order


# ── start ────────────────────────────────────────────────────────────────────
IN_FLIGHT_WINDOW = timedelta(seconds=30)


def start_payment(order: Order, provider_key: str, *, return_url: str, cancel_url: str) -> PaymentStart:
    """Create (or reuse) a payment attempt for `order`. Amount is always `order.total`, never client supplied."""
    if provider_key not in enabled_provider_keys():
        raise DomainError("This payment method is not available.", code="payment_method_unavailable", status_code=400)
    provider = get_provider(provider_key)

    for _ in range(IN_FLIGHT_POLLS):
        reused, payment, superseded = _begin_attempt(order, provider_key, provider)
        if reused is not None:
            return reused
        if payment is not None:
            break
        time.sleep(
            IN_FLIGHT_POLL_SECONDS
        )  # another request is creating the same checkout right now: wait, then reuse it
    else:
        raise Conflict(
            "A payment is already being started for this order. Please try again.", code="payment_in_progress"
        )

    # Provider call happens outside the row locks.
    try:
        created = provider.create_payment(payment, return_url=return_url, cancel_url=cancel_url)
    except ProviderError as exc:
        _fail_start(payment.pk, exc)
        raise DomainError(exc.safe_message, code="payment_provider_unavailable", status_code=502) from exc

    with transaction.atomic():
        payment, order = _lock_payment_then_order(payment.pk)
        payment.reference = created.reference
        payment.action_url = created.action_url
        payment.expires_at = created.expires_at
        payment.provider_charge_id = created.provider_charge_id
        was_superseded = payment.status != P.PENDING  # cancelled meanwhile by a newer attempt
        if created.action_url and not was_superseded:
            payment.status = P.REQUIRES_ACTION
        payment.save()
        sync_order_payment_status(order)
    if was_superseded:
        _cancel_remote(payment)
        raise Conflict("A newer payment attempt replaced this one. Please try again.", code="payment_superseded")
    log.info("payment started payment=%s order=%s provider=%s", payment.pk, order.number, provider_key)

    for old in superseded:  # best effort, never blocks the new attempt
        _cancel_remote(old)
    return PaymentStart(payment, _action(provider, payment))


def _begin_attempt(order: Order, provider_key: str, provider):
    """Phase 1 (locked): validate, reuse a valid live attempt, or create a new PENDING one.

    Returns (reuse_result, new_payment, superseded) where exactly one of reuse_result / new_payment is set, or both
    None when an identical attempt is being created by a concurrent request (caller waits and retries).
    """
    now = timezone.now()
    with transaction.atomic():
        order, attempts = _lock_order_and_payments(order.pk)
        if order.status in (Order.Status.CANCELLED, Order.Status.COMPLETED):
            raise Conflict("This order can no longer be paid.", code="order_not_payable")
        if any(p.status in SETTLED for p in attempts) or order.payment_status in (
            "PAID",
            "AUTHORIZED",
            "PARTIALLY_REFUNDED",
            "REFUNDED",
        ):
            raise Conflict("This order has already been paid.", code="already_paid")
        if order.total <= 0:
            raise Conflict("There is nothing to pay for this order.", code="nothing_to_pay")

        for p in attempts:
            if p.provider != provider_key:
                continue
            if provider.offline and p.status == P.PENDING:
                return PaymentStart(p, _action(provider, p)), None, []
            if p.status == P.REQUIRES_ACTION and (p.expires_at is None or p.expires_at > now + REUSE_MARGIN):
                return PaymentStart(p, _action(provider, p)), None, []
            if p.status == P.PENDING and not p.reference and p.created_at > now - IN_FLIGHT_WINDOW:
                return None, None, []

        superseded: list[Payment] = []  # attempts whose hosted page might still accept a payment
        for p in attempts:
            was_live = p.status in LIVE
            if was_live:
                p.status = P.CANCELLED
                p.save(update_fields=["status", "updated_at"])
            still_open = p.status == P.FAILED and (p.expires_at is None or p.expires_at > now)
            if p.reference and (was_live or still_open) and _is_online(p.provider):
                superseded.append(p)

        payment = Payment.objects.create(
            order=order,
            provider=provider_key,
            status=P.PENDING,
            amount=order.total,
            currency=order.currency,
            idempotency_key=f"pay-{order.number}-{len(attempts) + 1}",
            is_sandbox=provider.sandbox(),
        )
    return None, payment, superseded


def _cancel_remote(payment: Payment) -> None:
    try:
        get_provider(payment.provider).cancel_attempt(payment)
    except Exception:  # noqa: BLE001
        log.exception("could not cancel payment %s at provider", payment.pk)


def _fail_start(payment_id: int, exc: ProviderError) -> None:
    with transaction.atomic():
        payment, order = _lock_payment_then_order(payment_id)
        payment.status = P.FAILED
        payment.failure_code = exc.code[:60]
        payment.failure_message = exc.safe_message[:300]
        payment.save(update_fields=["status", "failure_code", "failure_message", "updated_at"])
        sync_order_payment_status(order)


def _is_online(provider_key: str) -> bool:
    try:
        return not get_provider(provider_key).offline
    except DomainError:  # provider switched off since: nothing to cancel remotely
        return False


def _action(provider, payment: Payment) -> dict:
    return provider.action_for(payment) or {"type": "none"}


def cancel_open_payments(order: Order) -> int:
    """Close any unsettled attempts (e.g. when an order is cancelled) so a late customer payment is not accepted."""
    to_cancel: list[Payment] = []
    with transaction.atomic():
        order, attempts = _lock_order_and_payments(order.pk)
        for p in (a for a in attempts if a.status in LIVE):
            p.status = P.CANCELLED
            p.save(update_fields=["status", "updated_at"])
            to_cancel.append(p)
        if to_cancel:
            sync_order_payment_status(order)
    for p in to_cancel:
        try:
            get_provider(p.provider).cancel_attempt(p)
        except Exception:  # noqa: BLE001
            log.exception("could not cancel payment %s at provider", p.pk)
    return len(to_cancel)


# ── provider events ──────────────────────────────────────────────────────────
def handle_provider_event(provider_key: str, event: ProviderEvent) -> PaymentEvent:
    """Apply a verified, normalised provider event exactly once. Returns the stored `PaymentEvent`.

    A replay returns the original row with `outcome == "duplicate"` (in memory) and changes nothing.
    """
    if not event.id:
        raise DomainError("Provider event has no id.", code="invalid_event", status_code=400)
    with transaction.atomic():
        record, created = PaymentEvent.objects.get_or_create(
            provider=provider_key,
            event_id=event.id[:120],
            defaults={"event_type": event.type[:80], "payload": event.raw},
        )
        if not created:
            log.info("payment event duplicate provider=%s event=%s", provider_key, event.id)
            record.outcome = "duplicate"  # not persisted: the stored row keeps the original outcome
            return record
        outcome, error, payment = _process_event(provider_key, event)
        record.payment = payment
        record.outcome = outcome
        record.error = error[:300]
        record.processed_at = timezone.now()
        record.save(update_fields=["payment", "outcome", "error", "processed_at"])
    level = logging.ERROR if outcome == "error" else logging.INFO
    log.log(
        level,
        "payment event provider=%s event=%s type=%s outcome=%s %s",
        provider_key,
        event.id,
        event.type,
        outcome,
        error,
    )
    return record


def _locate_payment(provider_key: str, event: ProviderEvent) -> Payment | None:
    if event.kind == pb.KIND_REFUND:
        refund = None
        cond = Q()
        if event.reference and event.status != pb.REFUND_CUMULATIVE:
            cond |= Q(reference=event.reference)
        if event.refund_key:
            cond |= Q(idempotency_key=event.refund_key)
        if cond:
            refund = Refund.objects.filter(cond, payment__provider=provider_key).select_related("payment").first()
        if refund:
            return refund.payment
    cond = Q()
    if event.reference:
        cond |= Q(reference=event.reference) | Q(provider_charge_id=event.reference)
    if event.provider_charge_id:
        cond |= Q(provider_charge_id=event.provider_charge_id)
    if event.payment_id:
        cond |= Q(pk=event.payment_id)
    if not cond:
        return None
    return Payment.objects.filter(cond, provider=provider_key).order_by("-created_at", "-id").first()


def _process_event(provider_key: str, event: ProviderEvent) -> tuple[str, str, Payment | None]:
    if event.kind == pb.KIND_IGNORED:
        return "ignored", "event type not handled", None
    found = _locate_payment(provider_key, event)
    if found is None:
        return "ignored", "no matching payment", None
    payment, order = _lock_payment_then_order(found.pk)
    if event.kind == pb.KIND_REFUND:
        outcome, error = _apply_refund_event(payment, order, event)
    else:
        outcome, error = _apply_payment_event(payment, order, event)
    return outcome, error, payment


def _apply_payment_event(payment: Payment, order: Order, event: ProviderEvent) -> tuple[str, str]:
    status = event.status
    if event.provider_charge_id and not payment.provider_charge_id:
        payment.provider_charge_id = event.provider_charge_id
        payment.save(update_fields=["provider_charge_id", "updated_at"])

    if status == pb.PENDING:
        return "ignored", "awaiting a final status from the provider"

    if status == pb.PAID:
        if payment.status in SETTLED:
            return "ignored", "payment already settled"
        if payment.flagged_reason == DUPLICATE_CHARGE:
            return "ignored", "duplicate charge already flagged"
        if event.amount is None or event.amount != payment.amount or event.currency.upper() != payment.currency.upper():
            payment.flagged_reason = AMOUNT_MISMATCH
            payment.save(update_fields=["flagged_reason", "updated_at"])
            return "error", (
                f"amount/currency mismatch: provider {event.amount} {event.currency}, expected {payment.amount} {payment.currency}"
            )
        if Payment.objects.filter(order=order, status__in=SETTLED).exclude(pk=payment.pk).exists():
            return _flag_duplicate_charge(payment)
        try:
            with (
                transaction.atomic()
            ):  # savepoint: the DB constraint is the last line of defence against double settlement
                _mark_paid(payment, order, event.provider_charge_id)
        except IntegrityError:
            payment = Payment.objects.get(pk=payment.pk)
            return _flag_duplicate_charge(payment)
        _after_paid(payment, order, auto_confirm=not get_provider(payment.provider).offline)
        return "applied", ""

    if payment.status in SETTLED:
        log.warning("late %s event ignored for settled payment %s", status, payment.pk)
        return "out_of_order", f"{status} event after the payment was settled"
    if payment.status in (P.FAILED, P.CANCELLED):
        return "ignored", f"payment already {payment.status.lower()}"

    if status == pb.FAILED:
        payment.status = P.FAILED
        payment.failure_code = event.failure_code[:60]
        payment.failure_message = event.failure_message[:300]
        payment.save(update_fields=["status", "failure_code", "failure_message", "updated_at"])
        sync_order_payment_status(order)
        if order.status not in (Order.Status.CANCELLED, Order.Status.COMPLETED):
            notify_order_event(order, "payment_failed")
        return "applied", ""

    if status == pb.CANCELLED:
        payment.status = P.CANCELLED
        payment.save(update_fields=["status", "updated_at"])
        sync_order_payment_status(order)
        return "applied", ""

    return "ignored", f"unhandled status {status}"


def _mark_paid(payment: Payment, order: Order, charge_id: str = "") -> None:
    payment.status = P.PAID
    payment.paid_at = timezone.now()
    payment.failure_code = ""
    payment.failure_message = ""
    payment.flagged_reason = ""
    if charge_id:
        payment.provider_charge_id = charge_id
    payment.save()


def _flag_duplicate_charge(payment: Payment) -> tuple[str, str]:
    """Money moved for an order that is already settled by another payment: keep the books honest, flag for refund."""
    payment.status = P.CANCELLED
    payment.flagged_reason = DUPLICATE_CHARGE
    payment.failure_code = DUPLICATE_CHARGE
    payment.failure_message = "Charged after the order was already paid. Refund required."
    payment.paid_at = timezone.now()
    payment.save()
    log.error("duplicate charge for order payment=%s order=%s: flagged for refund", payment.pk, payment.order_id)
    return "error", "order already has a settled payment; this charge must be refunded"


def _after_paid(payment: Payment, order: Order, *, auto_confirm: bool) -> None:
    from apps.core.models import StoreSettings

    sync_order_payment_status(order)
    if order.status == Order.Status.CANCELLED:
        log.warning("payment %s settled on cancelled order %s: refund required", payment.pk, order.number)
        return
    if auto_confirm and order.status == Order.Status.PENDING and StoreSettings.load().auto_confirm_paid_orders:
        from apps.orders import services as order_services

        try:
            with transaction.atomic():
                order_services.transition_order(order.id, Order.Status.CONFIRMED, actor=None, system=True)
        except DomainError as exc:
            log.warning("auto-confirm of %s skipped: %s", order.number, exc.detail)
        order.refresh_from_db()
    notify_order_event(order, "payment_confirmed")


# ── retrieval / sync ─────────────────────────────────────────────────────────
def sync_order_payment(order: Order) -> PaymentEvent | None:
    """Ask the provider (never the browser) for the truth about the order's latest unsettled attempt."""
    latest = Payment.objects.filter(order=order).order_by("-created_at", "-id").first()
    if latest is None or latest.status in SETTLED:
        return None
    provider = get_provider(latest.provider)
    if provider.offline:
        return None
    try:
        event = provider.retrieve(latest)
    except ProviderError as exc:
        raise DomainError(exc.safe_message, code="payment_provider_unavailable", status_code=502) from exc
    if event is None:
        return None
    return handle_provider_event(latest.provider, event)


# ── cash ─────────────────────────────────────────────────────────────────────
def mark_cash_collected(order: Order, actor) -> Payment:
    """Staff received the cash. Idempotent; creates the cash attempt if checkout did not."""
    if order.payment_method != Payment.Provider.CASH:
        raise Conflict("Only cash orders can be marked as collected.", code="not_cash_order")
    existing = (
        Payment.objects.filter(order=order, provider=Payment.Provider.CASH).order_by("-created_at", "-id").first()
    )
    with transaction.atomic():
        if existing is not None:
            payment, order = _lock_payment_then_order(existing.pk)
        else:
            order = Order.objects.select_for_update().get(pk=order.pk)
            payment = Payment.objects.filter(order=order, provider=Payment.Provider.CASH).first()
            if payment is None:
                payment = Payment.objects.create(
                    order=order,
                    provider=Payment.Provider.CASH,
                    status=P.PENDING,
                    amount=order.total,
                    currency=order.currency,
                    idempotency_key=f"pay-{order.number}-cash",
                )
        if payment.status in SETTLED:
            return payment  # already collected
        if order.status == Order.Status.CANCELLED:
            raise Conflict("This order is cancelled; no cash can be collected.", code="order_cancelled")
        if Payment.objects.filter(order=order, status__in=SETTLED).exclude(pk=payment.pk).exists():
            raise Conflict("This order has already been paid.", code="already_paid")
        _mark_paid(payment, order)
        sync_order_payment_status(order)
        audit(
            actor,
            "payment.cash_collected",
            payment,
            summary=f"Cash collected for order {order.number}",
            changes={"order": order.number, "amount": str(payment.amount), "currency": payment.currency},
        )
        notify_order_event(order, "payment_confirmed")
    log.info("cash collected payment=%s order=%s", payment.pk, order.number)
    return payment


# ── refunds ──────────────────────────────────────────────────────────────────
def reserved_refund_total(payment: Payment) -> Decimal:
    """Amount already refunded or in flight (PENDING + SUCCEEDED); FAILED refunds free their amount again."""
    if "refunds" in getattr(payment, "_prefetched_objects_cache", {}):  # list views prefetch: no query per row
        return sum((r.amount for r in payment.refunds.all() if r.status in (R.PENDING, R.SUCCEEDED)), ZERO)
    return payment.refunds.filter(status__in=[R.PENDING, R.SUCCEEDED]).aggregate(s=Sum("amount"))["s"] or ZERO


def is_refundable_payment(payment: Payment) -> bool:
    return payment.status in REFUNDABLE or (payment.flagged_reason == DUPLICATE_CHARGE and payment.paid_at is not None)


def refundable_amount(payment: Payment) -> Decimal:
    if not is_refundable_payment(payment):
        return ZERO
    return max(payment.amount - reserved_refund_total(payment), ZERO)


def refund_payment(payment: Payment, amount, reason: str, actor, *, idempotency_key: str | None = None) -> Refund:
    """Refund `amount` of `payment` via its provider. Validation errors raise DomainError; a provider failure returns a
    FAILED refund (nothing else changes) so callers can report the real outcome and the admin can retry."""
    try:
        amount = q(amount)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise DomainError("Enter a valid refund amount.", code="invalid_amount", status_code=400) from exc
    if amount <= 0:
        raise DomainError("The refund amount must be greater than zero.", code="invalid_amount", status_code=400)
    provider = get_provider(payment.provider)
    key = f"refund-{payment.pk}-{idempotency_key or uuid.uuid4().hex}"[:80]

    with transaction.atomic():
        payment = Payment.objects.select_for_update().get(pk=payment.pk)
        if idempotency_key:
            existing = Refund.objects.filter(idempotency_key=key).first()
            if existing is not None:
                return existing
        if not is_refundable_payment(payment):
            raise Conflict("Only paid payments can be refunded.", code="payment_not_refundable")
        remaining = refundable_amount(payment)
        if amount > remaining:
            raise Conflict(
                f"Only {remaining} {payment.currency} can still be refunded on this payment.",
                code="refund_exceeds_remaining",
                extra={"remaining": str(remaining)},
            )
        refund = Refund.objects.create(
            payment=payment,
            amount=amount,
            reason=(reason or "")[:200],
            status=R.PENDING,
            idempotency_key=key,
            initiated_by=actor if getattr(actor, "is_authenticated", False) else None,
        )

    try:
        result = provider.refund(payment, amount, key, reason or "")
    except ProviderError as exc:
        return _finish_refund(refund.pk, R.FAILED, actor=actor, message=exc.safe_message)
    except Exception:  # noqa: BLE001 - unknown outcome: never claim success, tell staff to check the provider
        log.exception("unexpected error refunding payment %s", payment.pk)
        return _finish_refund(
            refund.pk,
            R.FAILED,
            actor=actor,
            message="The refund could not be confirmed with the provider. Check the provider dashboard before retrying.",
        )
    return _finish_refund(
        refund.pk, R.SUCCEEDED if result.status == "succeeded" else R.PENDING, actor=actor, reference=result.reference
    )


def _finish_refund(refund_id: int, status: str, *, actor, reference: str = "", message: str = "") -> Refund:
    with transaction.atomic():
        payment_id = Refund.objects.values_list("payment_id", flat=True).get(pk=refund_id)
        payment, order = _lock_payment_then_order(payment_id)
        refund = Refund.objects.select_for_update().get(pk=refund_id)
        if refund.status != R.PENDING:  # a webhook already resolved it
            if reference and not refund.reference:
                refund.reference = reference
                refund.save(update_fields=["reference", "updated_at"])
            return refund
        refund.reference = reference or refund.reference
        refund.status = status
        refund.failure_message = message[:300]
        refund.save()
        if status == R.PENDING:
            return refund
        if status == R.SUCCEEDED:
            _apply_refund_totals(payment, order)
        audit(
            actor,
            "payment.refund" if status == R.SUCCEEDED else "payment.refund_failed",
            payment,
            summary=f"Refund of {refund.amount} {payment.currency} for order {order.number}: {status.lower()}",
            changes={
                "refund_id": refund.pk,
                "amount": str(refund.amount),
                "status": status,
                "order": order.number,
                "reason": refund.reason,
            },
        )
        log.info(
            "refund %s payment=%s order=%s amount=%s status=%s",
            refund.pk,
            payment.pk,
            order.number,
            refund.amount,
            status,
        )
        if status == R.SUCCEEDED:
            notify_order_event(order, "refund_updated")
    return refund


def _apply_refund_totals(payment: Payment, order: Order) -> None:
    succeeded = payment.refunds.filter(status=R.SUCCEEDED).aggregate(s=Sum("amount"))["s"] or ZERO
    payment.refunded_total = succeeded
    if payment.status in REFUNDABLE:
        payment.status = (
            P.REFUNDED if succeeded >= payment.amount else (P.PARTIALLY_REFUNDED if succeeded > 0 else P.PAID)
        )
    payment.save(update_fields=["refunded_total", "status", "updated_at"])
    sync_order_payment_status(order)


def _apply_refund_event(payment: Payment, order: Order, event: ProviderEvent) -> tuple[str, str]:
    """Reconcile provider-side refund news (webhooks) with our Refund rows."""
    if event.status == pb.REFUND_CUMULATIVE:
        known = reserved_refund_total(payment)
        if event.amount is None or event.amount <= known:
            return "ignored", "no refund the system does not already know about"
        diff = event.amount - known
        if event.amount > payment.amount:
            return "error", "provider reports more refunded than the payment amount"
        refund = Refund.objects.create(
            payment=payment,
            amount=diff,
            reason="Refunded directly at the payment provider",
            status=R.SUCCEEDED,
            reference=f"external-{event.id}"[:120],
            idempotency_key=f"external:{payment.provider}:{event.id}"[:80],
        )
        _apply_refund_totals(payment, order)
        audit(
            "system",
            "payment.refund_external",
            payment,
            summary=f"External refund of {diff} {payment.currency} reconciled for order {order.number}",
            changes={"refund_id": refund.pk, "amount": str(diff)},
        )
        notify_order_event(order, "refund_updated")
        return "applied", "external refund reconciled"

    cond = Q(idempotency_key=event.refund_key) if event.refund_key else Q()
    if event.reference:
        cond |= Q(reference=event.reference)
    refund = payment.refunds.select_for_update().filter(cond).first() if cond else None
    if refund is None:
        return "ignored", "refund not known to the system (reconciled via charge.refunded)"
    if event.reference and not refund.reference:
        refund.reference = event.reference

    if event.status == pb.REFUND_SUCCEEDED:
        if refund.status == R.SUCCEEDED:
            return "ignored", "refund already succeeded"
        others = (
            payment.refunds.filter(status__in=[R.PENDING, R.SUCCEEDED])
            .exclude(pk=refund.pk)
            .aggregate(s=Sum("amount"))["s"]
            or ZERO
        )
        if others + refund.amount > payment.amount:
            return "error", "applying this refund would exceed the paid amount"
        refund.status, refund.failure_message = R.SUCCEEDED, ""
        refund.save()
        _apply_refund_totals(payment, order)
        audit(
            "system",
            "payment.refund",
            payment,
            summary=f"Refund {refund.amount} {payment.currency} confirmed by provider for order {order.number}",
            changes={"refund_id": refund.pk, "status": "SUCCEEDED"},
        )
        notify_order_event(order, "refund_updated")
        return "applied", ""

    if event.status == pb.REFUND_FAILED:
        if refund.status == R.FAILED:
            return "ignored", "refund already failed"
        was_succeeded = refund.status == R.SUCCEEDED
        refund.status, refund.failure_message = (
            R.FAILED,
            (event.failure_message or "The provider could not complete this refund.")[:300],
        )
        refund.save()
        if was_succeeded:
            _apply_refund_totals(payment, order)
        audit(
            "system",
            "payment.refund_failed",
            payment,
            summary=f"Refund {refund.amount} {payment.currency} failed at provider for order {order.number}",
            changes={"refund_id": refund.pk, "status": "FAILED"},
        )
        return "applied", "refund failed at provider"

    refund.save(update_fields=["reference", "updated_at"])
    return "ignored", "refund still pending at provider"
