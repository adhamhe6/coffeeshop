from django.urls import path

from . import views

urlpatterns = [
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("tags/", views.TagListView.as_view(), name="tag-list"),
    path("products/", views.ProductListView.as_view(), name="product-list"),
    path("products/suggest/", views.ProductSuggestView.as_view(), name="product-suggest"),
    path("products/facets/", views.ProductFacetsView.as_view(), name="product-facets"),
    path("products/<slug:slug>/", views.ProductDetailView.as_view(), name="product-detail"),
    path("products/<slug:slug>/reviews/", views.ProductReviewsView.as_view(), name="product-reviews"),
    path(
        "products/<slug:slug>/reviews/eligibility/",
        views.ReviewEligibilityView.as_view(),
        name="product-review-eligibility",
    ),
    path("collections/", views.CollectionListView.as_view(), name="collection-list"),
    path("collections/<slug:slug>/", views.CollectionDetailView.as_view(), name="collection-detail"),
    path("favorites/", views.FavoriteListCreateView.as_view(), name="favorite-list"),
    path("favorites/ids/", views.FavoriteIdsView.as_view(), name="favorite-ids"),
    path("favorites/merge/", views.FavoriteMergeView.as_view(), name="favorite-merge"),
    path("favorites/<int:product_id>/", views.FavoriteDeleteView.as_view(), name="favorite-delete"),
]
