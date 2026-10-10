from .base import *  # noqa: F403

DEBUG = False
SECRET_KEY = "test-secret-key-not-for-any-real-use"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = False
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
SESSION_ENGINE = "django.contrib.sessions.backends.db"
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": dict.fromkeys(REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "10000/min"),  # noqa: F405
}
PAYMENT_DEMO_ENABLED = True
PAYMENT_PROVIDERS_ENABLED = ["demo", "cash", "stripe"]
STRIPE_SECRET_KEY = "sk_test_unit_tests_only"
STRIPE_WEBHOOK_SECRET = "whsec_unit_tests_only"
MEDIA_ROOT = BASE_DIR / ".test-media"  # noqa: F405
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
LOGGING["root"]["level"] = "WARNING"  # noqa: F405
