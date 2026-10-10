from django.urls import path

from . import views

urlpatterns = [
    path("checkout/", views.CheckoutView.as_view(), name="checkout"),
    path("orders/", views.OrderListView.as_view(), name="order-list"),
    path("orders/<str:number>/", views.OrderDetailView.as_view(), name="order-detail"),
    path("orders/<str:number>/cancel/", views.OrderCancelView.as_view(), name="order-cancel"),
    path("orders/<str:number>/reorder/", views.OrderReorderView.as_view(), name="order-reorder"),
    path("orders/<str:number>/pay/", views.OrderPayView.as_view(), name="order-pay"),
]
