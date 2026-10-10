from django.conf import settings
from django.db import models


class Notification(models.Model):
    """In-app notification for a customer (order/payment/refund updates). Emails are sent separately via Celery."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    order = models.ForeignKey(
        "orders.Order", null=True, blank=True, on_delete=models.CASCADE, related_name="notifications"
    )
    kind = models.CharField(max_length=40)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=300, blank=True)
    is_read = models.BooleanField(default=False)
    email_status = models.CharField(
        max_length=24,
        blank=True,
        help_text="'' | queued | sent | console | failed | skipped | skipped_unverified (address not verified)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["user", "is_read", "-created_at"])]
