from django.urls import path

from . import views

urlpatterns = [
    path("products/<slug:slug>/quote/", views.ProductQuoteView.as_view(), name="product-quote"),
    path("cart/", views.CartView.as_view(), name="cart"),
    path("cart/items/", views.CartItemsView.as_view(), name="cart-items"),
    path("cart/items/<int:pk>/", views.CartItemDetailView.as_view(), name="cart-item"),
    path("cart/acknowledge-prices/", views.AcknowledgePricesView.as_view(), name="cart-acknowledge-prices"),
    path("cart/preview/", views.CartPreviewView.as_view(), name="cart-preview"),
]
