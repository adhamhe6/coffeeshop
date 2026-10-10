from rest_framework.routers import SimpleRouter

from . import admin_views

router = SimpleRouter()
router.register("admin/customers", admin_views.CustomerViewSet, basename="admin-customer")
router.register("admin/staff", admin_views.StaffViewSet, basename="admin-staff")

urlpatterns = router.urls
