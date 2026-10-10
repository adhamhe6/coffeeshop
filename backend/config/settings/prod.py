"""Production-style settings. Fails fast on unsafe configuration."""

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403

DEBUG = False
_PLACEHOLDER_KEY_MARKERS = ("insecure", "replace-me", "change-me", "changeme", "not-for-any-real-use", "example")
if (
    len(SECRET_KEY) < 40  # noqa: F405
    or len(set(SECRET_KEY)) < 12  # noqa: F405 - "aaaa…" / "abababab…"
    or any(marker in SECRET_KEY.lower() for marker in _PLACEHOLDER_KEY_MARKERS)  # noqa: F405 - .env.example, dev & test keys
):
    raise ImproperlyConfigured(
        "Set DJANGO_SECRET_KEY to a unique random value of at least 40 characters "
        '(python -c "import secrets; print(secrets.token_urlsafe(64))"); placeholder values are refused.'
    )
if "*" in ALLOWED_HOSTS:  # noqa: F405
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list explicit hosts in production.")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)  # noqa: F405
# Keep True behind HTTPS. Only set false for a plain-http localhost trial of the Docker stack.
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=True)  # noqa: F405
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)  # noqa: F405
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False  # preload is an irreversible, per-domain business decision
SILENCED_SYSTEM_CHECKS = ["security.W021"]
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
USE_X_FORWARDED_HOST = False
LOG_JSON = True

# The sandbox payment adapter must never run in production unless explicitly (and loudly) allowed.
if PAYMENT_DEMO_ENABLED and not env.bool("ALLOW_DEMO_PAYMENTS_IN_PRODUCTION", default=False):  # noqa: F405
    PAYMENT_DEMO_ENABLED = False
    PAYMENT_PROVIDERS_ENABLED = [p for p in PAYMENT_PROVIDERS_ENABLED if p != "demo"]  # noqa: F405
if PAYMENT_DEMO_ENABLED and PAYMENT_DEMO_WEBHOOK_SECRET.startswith("demo-only"):  # noqa: F405
    raise ImproperlyConfigured("Demo payments in production require a unique PAYMENT_DEMO_WEBHOOK_SECRET.")
if "stripe" in PAYMENT_PROVIDERS_ENABLED and not (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET):  # noqa: F405
    raise ImproperlyConfigured("Stripe is enabled but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are missing.")

# Cross-origin access is not needed for the same-origin SPA behind the reverse proxy, so it is opt-in in production:
# without an explicit list no foreign (and in particular no localhost dev-server) origin is trusted with credentials.
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])  # noqa: F405
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])  # noqa: F405
