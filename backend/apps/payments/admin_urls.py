from django.urls import path

from . import admin_views

urlpatterns = [
    path("admin/payments/", admin_views.AdminPaymentListView.as_view(), name="admin-payment-list"),
    path("admin/payments/<int:pk>/", admin_views.AdminPaymentDetailView.as_view(), name="admin-payment-detail"),
    path("admin/payments/<int:pk>/refund/", admin_views.AdminPaymentRefundView.as_view(), name="admin-payment-refund"),
]
