"""Root API router (/api/v1/). Each app contributes `urls` (storefront) and `admin_urls` (staff). See docs/implementation-plan.md §6."""

from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

APPS = [
    "accounts",
    "core",
    "catalog",
    "branches",
    "inventory",
    "promotions",
    "cart",
    "orders",
    "payments",
    "notifications",
    "reports",
]

urlpatterns = [
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
]
for _app in APPS:
    urlpatterns += [path("", include(f"apps.{_app}.urls")), path("", include(f"apps.{_app}.admin_urls"))]
