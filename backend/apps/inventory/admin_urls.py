from django.urls import path
from rest_framework.routers import SimpleRouter

from . import admin_views

router = SimpleRouter()
router.register("admin/inventory/stock", admin_views.StockViewSet, basename="admin-inventory-stock")
router.register("admin/inventory/movements", admin_views.MovementViewSet, basename="admin-inventory-movement")

urlpatterns = [
    path("admin/inventory/adjust/", admin_views.AdjustStockView.as_view(), name="admin-inventory-adjust"),
    path("admin/inventory/availability/", admin_views.AvailabilityView.as_view(), name="admin-inventory-availability"),
    path("admin/inventory/summary/", admin_views.SummaryView.as_view(), name="admin-inventory-summary"),
    *router.urls,
]
