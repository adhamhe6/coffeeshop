from django.urls import path
from rest_framework.routers import SimpleRouter

from . import admin_views

router = SimpleRouter()
router.register("admin/branches", admin_views.AdminBranchViewSet, basename="admin-branch")
router.register("admin/delivery-zones", admin_views.AdminDeliveryZoneViewSet, basename="admin-delivery-zone")

urlpatterns = [
    # must precede the router so "options" is not read as a branch id
    path("admin/branches/options/", admin_views.AdminBranchOptionsView.as_view(), name="admin-branch-options"),
    *router.urls,
]
