from django.urls import path

from . import views

urlpatterns = [
    path("coupons/validate/", views.CouponValidateView.as_view(), name="coupon-validate"),
]
