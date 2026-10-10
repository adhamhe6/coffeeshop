from django.urls import path
from rest_framework.routers import SimpleRouter

from . import admin_views

router = SimpleRouter()
router.register("admin/social", admin_views.SocialProfileViewSet, basename="admin-social")
router.register("admin/pages", admin_views.ContentPageViewSet, basename="admin-page")
router.register("admin/blocks", admin_views.ContentBlockViewSet, basename="admin-block")
router.register("admin/announcements", admin_views.AnnouncementViewSet, basename="admin-announcement")
router.register("admin/newsletter", admin_views.NewsletterViewSet, basename="admin-newsletter")
router.register("admin/audit-logs", admin_views.AuditLogViewSet, basename="admin-audit-log")

urlpatterns = [
    path("admin/settings/", admin_views.StoreSettingsView.as_view(), name="admin-settings"),
    *router.urls,
]
