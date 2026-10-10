import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.db.models import DateTimeField, DurationField, ExpressionWrapper, F
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

from .models import Order
from .services import UNPAID_STATUSES, _cancel_locked

log = logging.getLogger(__name__)

CASH_EXPIRY_REASON = "Not confirmed by the branch in time"


@shared_task(name="apps.orders.tasks.expire_unpaid_orders")
def expire_unpaid_orders(batch_size: int = 200) -> int:
    """Cancel online-payment orders still PENDING and unpaid after UNPAID_ORDER_EXPIRY_MINUTES.

    Stock is restored and the coupon redemption voided by the cancellation. Safe to run concurrently and repeatedly:
    each order is re-checked under a row lock taken with SKIP LOCKED, so two workers never process the same order and
    an order a customer is paying/cancelling at that instant is simply picked up on the next run.
    """
    cutoff = timezone.now() - timedelta(minutes=settings.UNPAID_ORDER_EXPIRY_MINUTES)
    candidates = list(
        Order.objects.filter(status=Order.Status.PENDING, payment_status__in=UNPAID_STATUSES, placed_at__lt=cutoff)
        .exclude(payment_method="cash")
        .order_by("placed_at")
        .values_list("pk", flat=True)[:batch_size]
    )
    expired = 0
    for pk in candidates:
        try:
            with transaction.atomic():
                order = (
                    Order.objects.select_for_update(skip_locked=True, of=("self",))
                    .filter(
                        pk=pk,
                        status=Order.Status.PENDING,
                        payment_status__in=UNPAID_STATUSES,
                        placed_at__lt=cutoff,
                    )
                    .exclude(payment_method="cash")
                    .first()
                )
                if order is None:
                    continue
                _cancel_locked(order, user=None, label="system", reason="Payment not completed")
                expired += 1
        except Exception:
            log.exception("could not expire unpaid order pk=%s", pk)
    if expired:
        log.info("expired %s unpaid orders", expired)
    return expired


def _cash_deadline():
    """SQL expression: when an unconfirmed cash order expires.

    ASAP orders (no `requested_for`): `placed_at + CASH_ORDER_EXPIRY_MINUTES`.
    Scheduled orders: the later of that and `requested_for - branch.prep_minutes` (the last moment the branch can still
    start preparing). A customer therefore cannot dodge the grace period by booking a slot soon, and a slot booked days
    ahead is not cancelled before the branch has had a chance to confirm it.
    """
    grace = F("placed_at") + timedelta(minutes=settings.CASH_ORDER_EXPIRY_MINUTES)
    prep = ExpressionWrapper(F("branch__prep_minutes") * timedelta(minutes=1), output_field=DurationField())
    slot_start = ExpressionWrapper(F("requested_for") - prep, output_field=DateTimeField())
    return Greatest(
        ExpressionWrapper(grace, output_field=DateTimeField()),
        Coalesce(slot_start, ExpressionWrapper(grace, output_field=DateTimeField())),
        output_field=DateTimeField(),
    )


@shared_task(name="apps.orders.tasks.expire_unconfirmed_cash_orders")
def expire_unconfirmed_cash_orders(batch_size: int = 200) -> int:
    """Cancel cash orders staff never confirmed (still PENDING and uncollected) once their deadline has passed.

    Cash orders move no money, yet they hold STOCKED inventory and coupon usage, so an unattended one must not live
    forever (finding S8). Deadline: see `_cash_deadline`. Cancellation goes through the normal system path: stock is
    restored, the coupon redemption voided, the customer notified (reason "Not confirmed by the branch in time").
    Idempotent and safe to run concurrently (row lock with SKIP LOCKED, re-checked under the lock).
    """
    now = timezone.now()

    def due():
        return Order.objects.annotate(cash_deadline=_cash_deadline()).filter(
            status=Order.Status.PENDING,
            payment_method="cash",
            payment_status__in=UNPAID_STATUSES,
            cash_deadline__lt=now,
        )

    candidates = list(due().order_by("placed_at").values_list("pk", flat=True)[:batch_size])
    expired = 0
    for pk in candidates:
        try:
            with transaction.atomic():
                order = (
                    due()
                    .select_for_update(skip_locked=True, of=("self",))
                    .select_related("branch")
                    .filter(pk=pk)
                    .first()
                )
                if order is None:
                    continue
                _cancel_locked(order, user=None, label="system", reason=CASH_EXPIRY_REASON)
                expired += 1
        except Exception:
            log.exception("could not expire unconfirmed cash order pk=%s", pk)
    if expired:
        log.info("expired %s unconfirmed cash orders", expired)
    return expired
