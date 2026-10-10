import logging

from celery import shared_task
from django.db.models import Count
from django.utils import timezone

from .models import Cart
from .services import stale_cutoffs

log = logging.getLogger(__name__)


@shared_task(name="apps.cart.tasks.cleanup_stale_carts")
def cleanup_stale_carts() -> dict:
    """Delete guest carts untouched for 90 days, and empty guest carts untouched for 7 days. User carts are kept."""
    stale, empty_cutoff = stale_cutoffs(timezone.now())
    _, per_model = Cart.objects.filter(user__isnull=True, updated_at__lt=stale).delete()
    old = per_model.get("cart.Cart", 0)
    empty_ids = list(
        Cart.objects.filter(user__isnull=True, updated_at__lt=empty_cutoff)
        .annotate(n=Count("items"))
        .filter(n=0)
        .values_list("id", flat=True)
    )
    empty = Cart.objects.filter(id__in=empty_ids).delete()[1].get("cart.Cart", 0) if empty_ids else 0
    log.info("stale carts cleaned old=%s empty=%s", old, empty)
    return {"stale": old, "empty": empty}
