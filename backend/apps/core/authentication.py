"""Authentication helpers shared by the public auth endpoints."""

from __future__ import annotations

from rest_framework import exceptions
from rest_framework.authentication import SessionAuthentication

from .errors import DomainError


class EnforceCsrfMixin:
    """Enforce CSRF for *anonymous* callers too (login/register are state-changing).

    DRF's SessionAuthentication only checks CSRF once a user is logged in, which would leave "login CSRF" open.
    The SPA obtains the cookie from `GET /auth/csrf/` and echoes it in the `X-CSRFToken` header.
    """

    def perform_authentication(self, request):
        super().perform_authentication(request)
        if not request.user.is_authenticated:  # authenticated requests were already checked by SessionAuthentication
            try:
                SessionAuthentication().enforce_csrf(request)
            except exceptions.PermissionDenied as exc:
                raise DomainError(str(exc.detail), code="csrf_failed", status_code=403) from None
