from django.urls import path

from . import views

urlpatterns = [
    path("branches/", views.BranchListView.as_view(), name="branch-list"),
    path("branches/<slug:slug>/", views.BranchDetailView.as_view(), name="branch-detail"),
    path("branches/<slug:slug>/slots/", views.BranchSlotsView.as_view(), name="branch-slots"),
    path("delivery-zones/", views.DeliveryZoneListView.as_view(), name="delivery-zone-list"),
]
