from django.urls import path

from . import views

urlpatterns = [
    path("payments/methods/", views.PaymentMethodsView.as_view(), name="payment-methods"),
    path("payments/webhooks/stripe/", views.StripeWebhookView.as_view(), name="payment-webhook-stripe"),
    path("payments/webhooks/demo/", views.DemoWebhookView.as_view(), name="payment-webhook-demo"),
    path("payments/demo/<str:reference>/", views.DemoPaymentView.as_view(), name="payment-demo"),
    path("payments/demo/<str:reference>/complete/", views.DemoCompleteView.as_view(), name="payment-demo-complete"),
    path("orders/<str:number>/payment/sync/", views.PaymentSyncView.as_view(), name="order-payment-sync"),
]
