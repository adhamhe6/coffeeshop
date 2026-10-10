from django.urls import path

from . import admin_views as v

urlpatterns = [
    path("admin/orders/", v.AdminOrderListView.as_view(), name="admin-order-list"),
    path("admin/orders/queue/", v.AdminOrderQueueView.as_view(), name="admin-order-queue"),
    path("admin/orders/<str:number>/", v.AdminOrderDetailView.as_view(), name="admin-order-detail"),
    path("admin/orders/<str:number>/transition/", v.AdminOrderTransitionView.as_view(), name="admin-order-transition"),
    path("admin/orders/<str:number>/cancel/", v.AdminOrderCancelView.as_view(), name="admin-order-cancel"),
    path("admin/orders/<str:number>/notes/", v.AdminOrderNoteView.as_view(), name="admin-order-notes"),
    path(
        "admin/orders/<str:number>/collect-cash/",
        v.AdminOrderCollectCashView.as_view(),
        name="admin-order-collect-cash",
    ),
]
