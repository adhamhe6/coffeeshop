import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import Payment
from .registry import get_provider
from .services import handle_provider_event

log = logging.getLogger(__name__)


@shared_task(ignore_result=True)
def reconcile_open_payments(min_age_minutes: int = 5, max_age_hours: int = 26, limit: int = 100) -> int:
    """Safety net for lost webhooks: ask the provider about hosted-checkout attempts that are still open.

    Results go through the same `handle_provider_event` pipeline (deterministic event ids), so running this
    alongside real webhooks can never double-apply anything. Returns the number of attempts checked.
    """
    now = timezone.now()
    open_attempts = (
        Payment.objects.filter(
            status=Payment.Status.REQUIRES_ACTION,
            created_at__lte=now - timedelta(minutes=min_age_minutes),
            created_at__gte=now - timedelta(hours=max_age_hours),
        )
        .exclude(reference="")
        .exclude(provider__in=[Payment.Provider.CASH, Payment.Provider.DEMO])
        .order_by("created_at")[:limit]
    )
    checked = 0
    for payment in open_attempts:
        checked += 1
        try:
            event = get_provider(payment.provider).retrieve(payment)
            if event is not None:
                handle_provider_event(payment.provider, event)
        except Exception:  # noqa: BLE001 - one bad attempt must not stop the sweep
            log.exception("could not reconcile payment %s", payment.pk)
    return checked
