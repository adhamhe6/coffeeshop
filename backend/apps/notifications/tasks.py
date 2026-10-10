import logging

from celery import shared_task

from .models import Notification

log = logging.getLogger(__name__)

MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 30


@shared_task(bind=True, max_retries=MAX_RETRIES, ignore_result=True, acks_late=True)
def send_notification_email(self, notification_id: int) -> None:
    """Send the email for one notification. Retries 3x with exponential backoff, then records `failed`.

    Never touches order or payment state: failures only ever change `Notification.email_status`.
    """
    from . import emails

    try:
        notification = Notification.objects.select_related("order", "order__branch", "user").get(pk=notification_id)
    except Notification.DoesNotExist:
        log.warning("notification %s no longer exists; skipping email", notification_id)
        return
    if notification.email_status in {emails.STATUS_SENT, emails.STATUS_CONSOLE}:
        return  # redelivered task: already done
    try:
        status = emails.send_order_email(notification)
    except Exception as exc:  # noqa: BLE001
        attempt = self.request.retries
        if attempt >= self.max_retries:
            log.error("email for notification %s failed permanently: %s", notification_id, type(exc).__name__)
            Notification.objects.filter(pk=notification_id).update(email_status="failed")
            return
        log.warning(
            "email for notification %s failed (attempt %s): %s", notification_id, attempt + 1, type(exc).__name__
        )
        raise self.retry(exc=exc, countdown=BACKOFF_BASE_SECONDS * 2**attempt) from exc
    Notification.objects.filter(pk=notification_id).update(email_status=status)
