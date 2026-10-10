from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from apps.core import seo
from apps.core import views as core_views

urlpatterns = [
    path("healthz", core_views.ReadyView.as_view(), name="healthz"),
    path("sitemap.xml", seo.sitemap_xml, name="sitemap"),
    path("robots.txt", seo.robots_txt, name="robots"),
    path("django-admin/", admin.site.urls),
    path("api/v1/", include("config.api_urls")),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# LAST: the SPA shell answers every other browser navigation (api/, media/, static/, django-admin/, assets/ and
# paths that end in a file extension are excluded here and again inside the view).
urlpatterns += [
    re_path(
        r"^(?!(?:api|media|static|django-admin|assets)(?:/|$))(?P<path>(?:[^.]*|.*/[^/.]*))$",
        seo.spa_shell,
        name="spa-shell",
    ),
]
