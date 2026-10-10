"""Audit trail helper. Call from services/views after the business change succeeds (inside the same transaction)."""

from __future__ import annotations

from typing import Any

from .middleware import get_request_id
from .models import AuditLog

_SENSITIVE = {"password", "token", "secret", "card", "cvv", "client_secret", "authorization"}


def _scrub(value: Any):
    if isinstance(value, dict):
        return {k: ("[redacted]" if any(s in k.lower() for s in _SENSITIVE) else _scrub(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub(v) for v in value]
    return value if isinstance(value, (str, int, float, bool, type(None))) else str(value)


def client_ip(request) -> str | None:
    if request is None:
        return None
    # Trust only the entry appended by our own reverse proxy(ies); anything to its left is client-controlled.
    from django.conf import settings

    hops = [h.strip() for h in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if h.strip()]
    n = settings.REST_FRAMEWORK.get("NUM_PROXIES") or 0
    if hops and n and len(hops) >= n:
        return hops[-n]
    return request.META.get("REMOTE_ADDR") or None


def audit(
    actor,
    action: str,
    resource,
    *,
    summary: str = "",
    changes: dict | None = None,
    request=None,
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> AuditLog:
    """`resource` may be a model instance or None (then pass resource_type/resource_id)."""
    if resource is not None:
        resource_type = resource_type or resource._meta.label
        resource_id = resource_id or str(resource.pk)
    user = actor if getattr(actor, "is_authenticated", False) else None
    return AuditLog.objects.create(
        actor=user,
        actor_label=(user.email if user else (actor if isinstance(actor, str) else "system")),
        action=action,
        resource_type=resource_type or "",
        resource_id=resource_id or "",
        summary=summary[:300],
        changes=_scrub(changes or {}),
        request_id=get_request_id() if get_request_id() != "-" else "",
        ip_address=client_ip(request),
    )
