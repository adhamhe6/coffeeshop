from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.html import strip_tags

from apps.core.models import StoreSettings

from .models import User
from .services import VERIFY_MAX_AGE, make_reset_uid_token, make_verification_token

log = logging.getLogger(__name__)


def build_reset_url(uid: str, token: str) -> str:
    return f"{settings.SITE_URL.rstrip('/')}/reset-password?uid={uid}&token={token}"


@shared_task(
    bind=True,
    autoretry_for=(OSError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    ignore_result=True,
)
def send_password_reset_email(self, user_id: int) -> None:
    """Build and send the branded reset email. The token is minted here so it never travels through the broker."""
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None or not user.has_usable_password():
        return
    store = StoreSettings.load()
    uid, token = make_reset_uid_token(user)
    context = {
        "brand_name": store.brand_name,
        "tagline": store.tagline,
        "support_email": store.support_email,
        "first_name": user.first_name,
        "reset_url": build_reset_url(uid, token),
        "expires_minutes": settings.PASSWORD_RESET_TIMEOUT // 60,
        "site_url": settings.SITE_URL.rstrip("/"),
    }
    html = render_to_string("emails/password_reset.html", context)
    text = render_to_string("emails/password_reset.txt", context)
    message = EmailMultiAlternatives(
        subject=f"Reset your {store.brand_name} password",
        body=text or strip_tags(html),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    message.attach_alternative(html, "text/html")
    message.send()
    log.info("password reset email sent user_id=%s", user.pk)


def build_verification_url(token: str) -> str:
    return f"{settings.SITE_URL.rstrip('/')}/verify-email?token={token}"


@shared_task(
    bind=True,
    autoretry_for=(OSError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    ignore_result=True,
)
def send_verification_email(self, user_id: int) -> None:
    """Build and send the branded verification email. The token is minted here so it never travels through the broker.

    A no-op for unknown/inactive/already verified users, so a duplicate or late delivery is harmless. The token is bound
    to the address the user has *now*.
    """
    user = User.objects.filter(pk=user_id, is_active=True, email_verified_at__isnull=True).first()
    if user is None:
        return
    store = StoreSettings.load()
    context = {
        "brand_name": store.brand_name,
        "tagline": store.tagline,
        "support_email": store.support_email,
        "first_name": user.first_name,
        "verify_url": build_verification_url(make_verification_token(user)),
        "expires_days": VERIFY_MAX_AGE // 86400,
        "site_url": settings.SITE_URL.rstrip("/"),
    }
    html = render_to_string("emails/verify_email.html", context)
    text = render_to_string("emails/verify_email.txt", context)
    message = EmailMultiAlternatives(
        subject=f"Confirm your email for {store.brand_name}",
        body=text or strip_tags(html),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    message.attach_alternative(html, "text/html")
    message.send()
    log.info("verification email sent user_id=%s", user.pk)
