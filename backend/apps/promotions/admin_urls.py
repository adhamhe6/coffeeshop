from rest_framework.routers import SimpleRouter

from . import admin_views

router = SimpleRouter()
router.register("admin/coupons", admin_views.AdminCouponViewSet, basename="admin-coupon")

urlpatterns = router.urls
