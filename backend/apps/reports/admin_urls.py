from django.urls import path

from . import views

urlpatterns = [
    path("admin/dashboard/", views.DashboardView.as_view(), name="admin-dashboard"),
    path("admin/reports/definitions/", views.DefinitionsView.as_view(), name="admin-report-definitions"),
    path("admin/reports/sales/", views.SalesReportView.as_view(), name="admin-report-sales"),
    path(
        "admin/reports/orders-by-status/",
        views.OrdersByStatusReportView.as_view(),
        name="admin-report-orders-by-status",
    ),
    path("admin/reports/products/", views.ProductsReportView.as_view(), name="admin-report-products"),
    path("admin/reports/categories/", views.CategoriesReportView.as_view(), name="admin-report-categories"),
    path("admin/reports/branches/", views.BranchesReportView.as_view(), name="admin-report-branches"),
    path("admin/reports/promotions/", views.PromotionsReportView.as_view(), name="admin-report-promotions"),
    path("admin/reports/payments/", views.PaymentsReportView.as_view(), name="admin-report-payments"),
    path("admin/reports/refunds/", views.RefundsReportView.as_view(), name="admin-report-refunds"),
    path("admin/reports/inventory/", views.InventoryReportView.as_view(), name="admin-report-inventory"),
    path("admin/reports/customers/", views.CustomersReportView.as_view(), name="admin-report-customers"),
]
