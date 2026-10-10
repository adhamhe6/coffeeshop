import contextvars
import hashlib
import re
import uuid

from django.conf import settings
from django.http import HttpResponse
from django.urls import reverse
from rest_framework.throttling import BaseThrottle, SimpleRateThrottle

_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_VALID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def get_request_id() -> str:
    return _request_id.get()


class RequestIdMiddleware:
    """Attach a correlation id to every request (honours a sane inbound X-Request-ID) and echo it back."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rid = request.headers.get("X-Request-ID", "")
        if not _VALID.match(rid):
            rid = uuid.uuid4().hex
        request.request_id = rid
        token = _request_id.set(rid)
        try:
            response = self.get_response(request)
        finally:
            _request_id.reset(token)
        response["X-Request-ID"] = rid
        return response


class AdminLoginThrottle(SimpleRateThrottle):
    """Rate limit for the Django-admin login form. DRF throttles only cover API views, so without this the form is an
    unthrottled password-guessing endpoint for the most privileged accounts. Own rate table (not DRF's) so a relaxed
    API configuration can never loosen it; Redis outages fail open like every other throttle."""

    THROTTLE_RATES = {"admin_login": "10/min", "admin_login_user": "20/hour"}

    def __init__(self, scope: str, ident: str):
        self.scope = scope
        self.ident = ident
        super().__init__()

    def get_rate(self):
        return self.THROTTLE_RATES[self.scope]

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.ident}


class AdminLoginThrottleMiddleware:
    """429 for too many POSTs to /django-admin/login/ from one client address or against one account name."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "POST" and request.path == reverse("admin:login"):
            username = request.POST.get("username", "").strip().lower()[:254]
            idents = [
                ("admin_login", BaseThrottle().get_ident(request)),
                ("admin_login_user", hashlib.sha256(username.encode()).hexdigest()),
            ]
            for scope, ident in idents:
                throttle = AdminLoginThrottle(scope, ident)
                if not throttle.allow_request(request, None):
                    response = HttpResponse(
                        "Too many sign-in attempts. Please wait and try again.", status=429, content_type="text/plain"
                    )
                    wait = throttle.wait()
                    if wait:
                        response["Retry-After"] = str(int(wait) + 1)
                    return response
        return self.get_response(request)


class PrivateApiCacheMiddleware:
    """Signed-in API responses (orders, addresses, staff data...) that set no cache policy of their own are marked
    `private, no-store`, so a shared computer or intermediary never keeps them. Explicit policies (public catalogue
    endpoints) are left alone."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            request.path.startswith("/api/")
            and settings.SESSION_COOKIE_NAME in request.COOKIES
            and "Cache-Control" not in response
        ):
            response["Cache-Control"] = "private, no-store"
        return response
