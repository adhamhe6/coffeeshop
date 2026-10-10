from rest_framework.routers import SimpleRouter

from . import admin_views

router = SimpleRouter()
router.register("admin/products", admin_views.AdminProductViewSet, basename="admin-product")
router.register("admin/categories", admin_views.AdminCategoryViewSet, basename="admin-category")
router.register("admin/modifier-groups", admin_views.AdminModifierGroupViewSet, basename="admin-modifier-group")
router.register("admin/collections", admin_views.AdminCollectionViewSet, basename="admin-collection")
router.register("admin/tags", admin_views.AdminTagViewSet, basename="admin-tag")
router.register("admin/reviews", admin_views.AdminReviewViewSet, basename="admin-review")

urlpatterns = router.urls
