"""Base settings shared by every environment. All deployment-specific values come from the environment."""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env()
environ.Env.read_env(BASE_DIR.parent / ".env", overwrite=False)

DEBUG = env.bool("DJANGO_DEBUG", default=False)
SECRET_KEY = env("DJANGO_SECRET_KEY", default="insecure-dev-only-key-change-me")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1", "[::1]", "testserver"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "corsheaders",
    "apps.core",
    "apps.accounts",
    "apps.catalog",
    "apps.branches",
    "apps.inventory",
    "apps.promotions",
    "apps.cart",
    "apps.orders",
    "apps.payments",
    "apps.notifications",
    "apps.reports",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "apps.core.middleware.RequestIdMiddleware",
    "apps.core.middleware.AdminLoginThrottleMiddleware",
    "apps.core.middleware.PrivateApiCacheMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://coffee:coffee@127.0.0.1:5432/coffee"),
}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = env("REDIS_URL", default="redis://127.0.0.1:6379/0")
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "KEY_PREFIX": "lantern",
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            # A Redis outage must degrade to cache misses, never to 500s or corrupted business data.
            "IGNORE_EXCEPTIONS": True,
            "SOCKET_CONNECT_TIMEOUT": 1,
            "SOCKET_TIMEOUT": 1,
        },
    }
}
DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS = (
    False  # outages are surfaced by /health/ready (degraded) instead of a traceback per cache call
)

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher"
    if env.bool("USE_ARGON2", default=False)
    else "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
PASSWORD_RESET_TIMEOUT = 60 * 60  # seconds

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("STORE_TIME_ZONE", default="UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", default=str(BASE_DIR / "media")))
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024

# ── Sessions / CSRF (session auth for the same-site SPA) ──────────────────────
SESSION_ENGINE = "django.contrib.sessions.backends.cached_db"
SESSION_COOKIE_NAME = "lantern_sessionid"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
CSRF_COOKIE_NAME = "lantern_csrftoken"
CSRF_COOKIE_HTTPONLY = False  # the SPA reads it and echoes it in X-CSRFToken
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=["http://localhost:5173", "http://127.0.0.1:5173"])
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173", "http://127.0.0.1:5173"])
CORS_ALLOW_CREDENTIALS = True
CART_COOKIE_NAME = "lantern_cart"

# ── DRF ───────────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticatedOrReadOnly"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [
        "apps.core.parsers.SafeJSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.errors.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "login": env("THROTTLE_LOGIN", default="10/min"),
        "register": env("THROTTLE_REGISTER", default="10/hour"),
        "password_reset": "5/hour",
        "verify": "20/hour",  # email verification link redemption
        "resend_verification": "5/hour",  # per signed-in user: each call sends an email
        "email_change": "5/hour",  # per signed-in user: a changed address gets a verification email
        "coupon": "30/min",
        "checkout": "20/min",
        "review": "10/hour",
        "newsletter": "10/hour",
        "cart_create": "60/hour",  # new anonymous carts per client address
    },
    "NUM_PROXIES": env.int(
        "NUM_PROXIES", default=1
    ),  # nginx / Vite proxy sits in front; throttles key on the real client IP
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}
SPECTACULAR_SETTINGS = {
    "TITLE": "Lantern Coffee Commerce API",
    "DESCRIPTION": "Storefront, account, checkout and operations API. Money values are decimal strings.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
    "ENUM_NAME_OVERRIDES": {
        "OrderStatusEnum": "apps.orders.models.Order.Status",
        "OrderPaymentStatusEnum": "apps.orders.models.Order.PaymentStatus",
        "OrderTypeEnum": "apps.orders.models.Order.Type",
        "PaymentStatusEnum": "apps.payments.models.Payment.Status",
        "PaymentProviderEnum": "apps.payments.models.Payment.Provider",
        "RefundStatusEnum": "apps.payments.models.Refund.Status",
        "ReviewStatusEnum": "apps.catalog.models.Review.Status",
        "StaffRoleEnum": "apps.accounts.models.StaffProfile.Role",
        "ProductTypeEnum": "apps.catalog.models.Product.Type",
        "StockModeEnum": "apps.catalog.models.Product.StockMode",
        "MovementTypeEnum": "apps.inventory.models.InventoryMovement.Type",
    },
}

# ── Celery ────────────────────────────────────────────────────────────────────
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=REDIS_URL)
CELERY_RESULT_BACKEND = None
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)
CELERY_TIMEZONE = "UTC"
CELERY_BEAT_SCHEDULE = {
    "expire-unpaid-orders": {"task": "apps.orders.tasks.expire_unpaid_orders", "schedule": 300.0},
    "expire-unconfirmed-cash-orders": {"task": "apps.orders.tasks.expire_unconfirmed_cash_orders", "schedule": 300.0},
    "cleanup-stale-carts": {"task": "apps.cart.tasks.cleanup_stale_carts", "schedule": 60 * 60 * 6.0},
    "reconcile-open-payments": {"task": "apps.payments.tasks.reconcile_open_payments", "schedule": 600.0},
}

# ── Email ─────────────────────────────────────────────────────────────────────
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=25)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Lantern Coffee <hello@lantern.example>")
# Public storefront origin, used in emails and payment return URLs.
SITE_URL = env("SITE_URL", default="http://localhost:5173")

# ── Store defaults (the StoreSettings row overrides these at runtime) ────────
STORE_DEFAULTS = {
    "brand_name": env("STORE_BRAND_NAME", default="Lantern Coffee Roasters"),
    "currency": env("STORE_CURRENCY", default="USD"),
}

# ── Payments ──────────────────────────────────────────────────────────────────
PAYMENT_PROVIDERS_ENABLED = env.list("PAYMENT_PROVIDERS_ENABLED", default=["demo", "cash"])
PAYMENT_DEMO_ENABLED = env.bool("PAYMENT_DEMO_ENABLED", default=True)
PAYMENT_DEMO_WEBHOOK_SECRET = env("PAYMENT_DEMO_WEBHOOK_SECRET", default="demo-only-secret-not-for-production")
STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY", default="")
STRIPE_PUBLISHABLE_KEY = env("STRIPE_PUBLISHABLE_KEY", default="")
STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET", default="")
UNPAID_ORDER_EXPIRY_MINUTES = env.int("UNPAID_ORDER_EXPIRY_MINUTES", default=30)
# Cash orders reserve stock and coupon usage without any money moving, so the branch must confirm them in time
# (scheduled orders: see apps/orders/tasks.py) and a customer may hold only a few unconfirmed ones at once.
CASH_ORDER_EXPIRY_MINUTES = env.int("CASH_ORDER_EXPIRY_MINUTES", default=120)
MAX_OPEN_CASH_ORDERS_PER_CUSTOMER = env.int("MAX_OPEN_CASH_ORDERS_PER_CUSTOMER", default=3)

# ── SEO shell ─────────────────────────────────────────────────────────────────
FRONTEND_INDEX_HTML = env("FRONTEND_INDEX_HTML", default=str(BASE_DIR.parent / "frontend" / "dist" / "index.html"))

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_LEVEL = env("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "apps.core.logging.RequestIdFilter"}},
    "formatters": {
        "json": {
            "()": "pythonjsonlogger.json.JsonFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s %(request_id)s %(message)s",
        },
        "plain": {"format": "%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json" if env.bool("LOG_JSON", default=False) else "plain",
            "filters": ["request_id"],
        }
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {"django.db.backends": {"level": "WARNING"}, "django.server": {"level": "WARNING"}},
}
