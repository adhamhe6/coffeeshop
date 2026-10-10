import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.catalog.models import Favorite, Product, Review
from apps.core.models import StoreSettings
from apps.inventory.models import BranchProduct
from apps.inventory.tests.helpers import make_order
from tests.factories import make_branch, make_category, make_product, make_user

pytestmark = pytest.mark.django_db


# ── reviews ─────────────────────────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def product():
    return make_product("Flat White")


def reviews_url(product):
    return f"/api/v1/products/{product.slug}/reviews/"


def eligibility_url(product):
    return reviews_url(product) + "eligibility/"


def buyer_of(product, status="COMPLETED"):
    user = make_user(first_name="Alex", last_name="Morgan")
    order = make_order(make_branch(), [(product, 1)], customer=user, status=status)
    return user, order


def test_list_shows_only_approved_with_demo_flag_and_masked_author(api, product):
    alex = make_user(first_name="alex", last_name="morgan", email="alex.private@example.com")
    Review.objects.create(product=product, user=alex, rating=5, title="Great", body="Loved it", status="APPROVED")
    Review.objects.create(
        product=product, user=make_user(first_name="Sam", last_name=""), rating=4, status="APPROVED", is_demo=True
    )
    Review.objects.create(product=product, user=make_user(first_name="", last_name="Z"), rating=3, status="APPROVED")
    Review.objects.create(product=product, user=make_user(), rating=1, status="PENDING")
    Review.objects.create(product=product, user=make_user(), rating=1, status="REJECTED")
    r = api.get(reviews_url(product))
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 3
    by_author = {x["author"]: x for x in body["results"]}
    assert set(by_author) == {"alex M.", "Sam", "Customer"}
    assert by_author["Sam"]["is_demo"] is True and by_author["alex M."]["is_demo"] is False
    assert "alex.private" not in r.content.decode() and "user" not in by_author["Sam"]
    assert set(by_author["Sam"]) == {
        "id",
        "rating",
        "title",
        "body",
        "author",
        "verified_purchase",
        "is_demo",
        "created_at",
    }


def test_list_paginates_and_404_for_hidden_product(api, product):
    for _ in range(25):
        Review.objects.create(product=product, user=make_user(), rating=5, status="APPROVED")
    r = api.get(reviews_url(product)).json()
    assert r["count"] == 25 and len(r["results"]) == 20 and r["next"]
    hidden = make_product(is_active=False)
    assert api.get(reviews_url(hidden)).status_code == 404
    assert api.get("/api/v1/products/nope/reviews/").status_code == 404


def test_post_requires_login(api, product):
    r = api.post(reviews_url(product), {"rating": 5})
    assert r.status_code == 401 and r.json()["error"]["code"] == "not_authenticated"


def test_post_creates_pending_review_linked_to_order(api, login, product):
    user, order = buyer_of(product)
    login(user)
    r = api.post(reviews_url(product), {"rating": 5, "title": " Lovely ", "body": "Silky and balanced."})
    assert r.status_code == 201, r.content
    assert r.json()["status"] == "PENDING" and r.json()["title"] == "Lovely"
    review = Review.objects.get()
    assert (review.user, review.product, review.order, review.status, review.is_demo) == (
        user,
        product,
        order,
        "PENDING",
        False,
    )
    assert api.get(reviews_url(product)).json()["count"] == 0  # not visible until approved
    assert api.get(f"/api/v1/products/{product.slug}/").json()["rating_count"] == 0


def test_post_validation(api, login, product):
    user, _ = buyer_of(product)
    login(user)
    for payload in (
        {},
        {"rating": 0},
        {"rating": 6},
        {"rating": "x"},
        {"rating": 5, "title": "t" * 101},
        {"rating": 5, "body": "b" * 2001},
    ):
        r = api.post(reviews_url(product), payload)
        assert r.status_code == 400, payload
        assert r.json()["error"]["code"] == "validation_error"
    assert not Review.objects.exists()


@pytest.mark.parametrize(
    "status", ["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "CANCELLED"]
)
def test_post_requires_completed_order_with_the_product(api, login, product, status):
    user, _ = buyer_of(product, status=status)
    login(user)
    r = api.post(reviews_url(product), {"rating": 5})
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_purchased"
    assert not Review.objects.exists()


def test_post_rejects_other_products_and_other_customers_orders(api, login, product):
    other_product = make_product()
    user = make_user()
    make_order(make_branch(), [(other_product, 1)], customer=user, status="COMPLETED")
    stranger, _ = buyer_of(product)  # somebody else completed an order with the product
    login(user)
    assert api.post(reviews_url(product), {"rating": 5}).status_code == 403
    assert stranger.pk != user.pk


def test_post_one_review_per_user_per_product(api, login, product):
    user, _ = buyer_of(product)
    login(user)
    assert api.post(reviews_url(product), {"rating": 5}).status_code == 201
    r = api.post(reviews_url(product), {"rating": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_reviewed"
    assert Review.objects.count() == 1


def test_post_honours_enable_reviews_setting(api, login, product):
    user, _ = buyer_of(product)
    login(user)
    StoreSettings.load()
    StoreSettings.objects.filter(pk=1).update(enable_reviews=False)
    r = api.post(reviews_url(product), {"rating": 5})
    assert r.status_code == 403 and r.json()["error"]["code"] == "reviews_disabled"


def test_post_to_hidden_product_is_404(api, login):
    hidden = make_product(is_active=False)
    user, _ = buyer_of(hidden)
    login(user)
    assert api.post(reviews_url(hidden), {"rating": 5}).status_code == 404


def test_eligibility_endpoint(api, login, product):
    anon = api.get(eligibility_url(product))
    assert anon.status_code == 200 and anon.json() == {"can_review": False, "reason": "login_required"}
    stranger = make_user()
    login(stranger)
    assert api.get(eligibility_url(product)).json() == {"can_review": False, "reason": "not_purchased"}
    buyer, _ = buyer_of(product)
    login(buyer)
    assert api.get(eligibility_url(product)).json() == {"can_review": True, "reason": None}
    api.post(reviews_url(product), {"rating": 4})
    assert api.get(eligibility_url(product)).json() == {"can_review": False, "reason": "already_reviewed"}
    StoreSettings.load()
    StoreSettings.objects.filter(pk=1).update(enable_reviews=False)
    assert api.get(eligibility_url(product)).json()["reason"] == "reviews_disabled"


# ── favorites ───────────────────────────────────────────────────────────────────────────────────────────────────────

FAV = "/api/v1/favorites/"


def test_favorites_require_auth(api):
    for method, url in (
        ("get", FAV),
        ("post", FAV),
        ("delete", FAV + "1/"),
        ("get", FAV + "ids/"),
        ("post", FAV + "merge/"),
    ):
        assert getattr(api, method)(url).status_code == 401, (method, url)


def test_add_is_idempotent_and_listed_newest_first(api, login):
    user = make_user()
    a, b = make_product("A"), make_product("B")
    login(user)
    r = api.post(FAV, {"product_id": a.id})
    assert r.status_code == 201 and r.json() == {"product_id": a.id}
    assert api.post(FAV, {"product_id": a.id}).status_code == 200  # repeat
    assert api.post(FAV, {"product_id": b.id}).status_code == 201
    assert Favorite.objects.filter(user=user).count() == 2
    listed = api.get(FAV).json()
    assert [p["name"] for p in listed["results"]] == ["B", "A"]
    assert listed["results"][0]["category"]["name"] and "base_price" in listed["results"][0]
    assert api.get(FAV + "ids/").json() == {"ids": [b.id, a.id]}


def test_add_unknown_or_inactive_is_404_and_bad_payload_400(api, login):
    login(make_user())
    hidden = make_product(is_active=False)
    in_hidden_cat = make_product(category=make_category(is_active=False))
    for pid in (hidden.id, in_hidden_cat.id, 999999):
        r = api.post(FAV, {"product_id": pid})
        assert r.status_code == 404, pid
    assert api.post(FAV, {}).status_code == 400
    assert api.post(FAV, {"product_id": "x"}).status_code == 400
    assert not Favorite.objects.exists()


def test_delete_is_idempotent(api, login):
    user = make_user()
    p = make_product()
    Favorite.objects.create(user=user, product=p)
    login(user)
    assert api.delete(f"{FAV}{p.id}/").status_code == 204
    assert api.delete(f"{FAV}{p.id}/").status_code == 204
    assert api.delete(f"{FAV}999999/").status_code == 204
    assert not Favorite.objects.exists()


def test_favorites_are_isolated_between_users(api, login):
    alice, bob = make_user(), make_user()
    shared, only_alice = make_product("Shared"), make_product("OnlyAlice")
    Favorite.objects.create(user=alice, product=shared)
    Favorite.objects.create(user=alice, product=only_alice)
    Favorite.objects.create(user=bob, product=shared)
    login(bob)
    assert [p["name"] for p in api.get(FAV).json()["results"]] == ["Shared"]
    assert api.get(FAV + "ids/").json() == {"ids": [shared.id]}
    api.delete(f"{FAV}{only_alice.id}/")  # bob cannot remove alice's favorite
    api.delete(f"{FAV}{shared.id}/")
    assert set(Favorite.objects.filter(user=alice).values_list("product__name", flat=True)) == {"Shared", "OnlyAlice"}
    assert not Favorite.objects.filter(user=bob).exists()


def test_inactive_favorites_hidden_from_list_but_kept(api, login):
    user = make_user()
    p = make_product("Seasonal")
    Favorite.objects.create(user=user, product=p)
    login(user)
    p.is_active = False
    p.save()
    assert api.get(FAV).json()["count"] == 0
    p.is_active = True
    p.save()
    assert api.get(FAV).json()["count"] == 1


def test_favorites_list_is_availability_aware_per_branch(api, login):
    user = make_user()
    branch = make_branch(slug="b1")
    p = make_product("Special")
    Favorite.objects.create(user=user, product=p)
    BranchProduct.objects.create(branch=branch, product=p, is_available=False)
    login(user)
    assert api.get(FAV).json()["results"][0]["is_available"] is True
    row = api.get(FAV + "?branch=b1").json()["results"][0]
    assert (row["is_available"], row["unavailable_reason"]) == (False, "branch_unavailable")


def test_merge_ignores_invalid_ids_and_is_idempotent(api, login):
    user = make_user()
    ok1, ok2, inactive = make_product("One"), make_product("Two"), make_product(is_active=False)
    Favorite.objects.create(user=user, product=ok1)
    login(user)
    r = api.post(FAV + "merge/", {"product_ids": [ok1.id, ok2.id, inactive.id, 999999, ok2.id]})
    assert r.status_code == 200
    assert r.json()["added"] == 1 and set(r.json()["ids"]) == {ok1.id, ok2.id}
    assert api.post(FAV + "merge/", {"product_ids": [ok1.id, ok2.id]}).json()["added"] == 0
    assert api.post(FAV + "merge/", {"product_ids": []}).json()["added"] == 0
    assert api.post(FAV + "merge/", {"product_ids": "x"}).status_code == 400


def test_merge_considers_at_most_100_ids(api, login):
    user = make_user()
    cat = make_category()
    products = [make_product(f"P{i}", category=cat) for i in range(105)]
    login(user)
    r = api.post(FAV + "merge/", {"product_ids": [p.id for p in products]})
    assert r.json()["added"] == 100
    assert Favorite.objects.filter(user=user).count() == 100


# ── query counts (no N+1) ──────────────────────────────────────────────────────────────────────────────────────────


def count_queries(api, url):
    with CaptureQueriesContext(connection) as ctx:
        r = api.get(url)
    assert r.status_code == 200, r.content
    return len(ctx)


def seed_menu(n):
    from apps.catalog.models import Tag
    from tests.factories import make_modifier_group, make_stock

    cat = make_category()
    tag = Tag.objects.create(name=f"t{n}", slug=f"t{n}")
    branch = make_branch(slug=f"qc{n}")
    for i in range(n):
        p = make_product(f"Prod {n}-{i}", category=cat, stocked=bool(i % 2), allergens=["milk"])
        p.tags.add(tag)
        make_modifier_group(p, f"G{n}-{i}", options=[("a", "0"), ("b", "1")])
        Review.objects.create(product=p, user=make_user(), rating=4, status="APPROVED")
        if i % 2:
            make_stock(branch, p, 3)
    return branch


def test_product_list_query_count_is_constant(api, django_assert_max_num_queries):
    from django.core.cache import cache

    seed_menu(3)
    cache.clear()
    small = count_queries(api, "/api/v1/products/?branch=qc3")
    cache.clear()
    seed_menu(15)
    cache.clear()
    big = count_queries(api, "/api/v1/products/?branch=qc15&page_size=100")
    assert big == small, (small, big)
    assert big <= 8
    with django_assert_max_num_queries(3):  # cached: availability overlay only
        api.get("/api/v1/products/?branch=qc15&page_size=100")


def test_product_detail_query_count_is_constant(api):
    from django.core.cache import cache

    seed_menu(8)
    cache.clear()
    slug = Product.objects.first().slug
    assert count_queries(api, f"/api/v1/products/{slug}/?branch=qc8") <= 12


def test_search_query_count_small(api):
    seed_menu(10)
    assert count_queries(api, "/api/v1/products/?q=prod&branch=qc10") <= 8


def test_favorites_query_count_is_constant(api, login):
    user = make_user()
    branch = seed_menu(12)
    for p in Product.objects.all():
        Favorite.objects.create(user=user, product=p)
    login(user)
    n12 = count_queries(api, f"/api/v1/favorites/?branch={branch.slug}")
    Favorite.objects.filter(user=user).delete()
    for p in Product.objects.all()[:3]:
        Favorite.objects.create(user=user, product=p)
    n3 = count_queries(api, f"/api/v1/favorites/?branch={branch.slug}")
    assert n12 == n3 and n12 <= 12


@pytest.mark.django_db(transaction=True)
def test_simultaneous_review_submissions_create_exactly_one(product):
    import threading

    from django.db import connection
    from rest_framework.test import APIClient

    user, _ = buyer_of(product)
    barrier = threading.Barrier(4)
    codes: list[int] = []

    def worker():
        client = APIClient()
        client.force_login(user)
        try:
            barrier.wait()
            codes.append(client.post(reviews_url(product), {"rating": 5}).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(codes) == [201, 409, 409, 409]
    assert Review.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_simultaneous_favorite_adds_are_idempotent():
    import threading

    from django.db import connection
    from rest_framework.test import APIClient

    user, p = make_user(), make_product()
    barrier = threading.Barrier(4)
    codes: list[int] = []

    def worker():
        client = APIClient()
        client.force_login(user)
        try:
            barrier.wait()
            codes.append(client.post(FAV, {"product_id": p.id}).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert set(codes) <= {200, 201} and codes.count(201) == 1
    assert Favorite.objects.filter(user=user).count() == 1
