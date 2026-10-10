from django.urls import path

from . import views

urlpatterns = [
    path("store/", views.StoreView.as_view(), name="store"),
    path("content/pages/<slug:slug>/", views.ContentPageView.as_view(), name="content-page"),
    path("content/blocks/", views.ContentBlocksView.as_view(), name="content-blocks"),
    path("newsletter/subscribe/", views.NewsletterSubscribeView.as_view(), name="newsletter-subscribe"),
    path("health/live/", views.LiveView.as_view(), name="health-live"),
    path("health/ready/", views.ReadyView.as_view(), name="health-ready"),
]
