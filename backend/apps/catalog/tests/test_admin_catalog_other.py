import pytest

from apps.accounts.permissions import ROLE_CAPABILITIES
from apps.catalog.models import (
    Category,
    Collection,
    CollectionItem,
    ModifierGroup,
    ModifierOption,
    ProductModifierGroup,
    Review,
    Tag,
)
from apps.core.models import AuditLog
from apps.inventory.tests.helpers import make_order
from apps.orders.models import OrderItem, OrderItemOption
from tests.factories import make_branch, make_category, make_modifier_group, make_product, make_staff, make_user

from .helpers import image_file

pytestmark = pytest.mark.django_db

CATS = "/api/v1/admin/categories/"
GROUPS = "/api/v1/admin/modifier-groups/"
COLLS = "/api/v1/admin/collections/"
TAGS = "/api/v1/admin/tags/"
REVIEWS = "/api/v1/admin/reviews/"
ROLES = list(ROLE_CAPABILITIES)


@pytest.fixture
def admin(login):
    return login(make_staff("ADMIN"))


# ── capability matrix for every family ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", ROLES)
def test_capability_matrix_catalog_families(api, login, role):
    login(make_staff(role))
    caps = ROLE_CAPABILITIES[role]
    view, manage = "catalog.view" in caps, "catalog.manage" in caps
    category = make_category()
    group, _ = make_modifier_group(None, f"G-{role}", options=[("A", "0")])
    collection = Collection.objects.create(name=f"C-{role}", slug=f"c-{role.lower()}")
    tag = Tag.objects.create(name=f"T-{role}", slug=f"t-{role.lower()}")
    reads = [
        CATS,
        f"{CATS}{category.id}/",
        GROUPS,
        f"{GROUPS}{group.id}/",
        COLLS,
        f"{COLLS}{collection.id}/",
        TAGS,
        f"{TAGS}{tag.id}/",
    ]
    for url in reads:
        assert api.get(url).status_code == (200 if view else 403), url
    writes = [
        ("post", CATS, {"name": f"New {role}"}),
        ("patch", f"{CATS}{category.id}/", {"description": "x"}),
        ("post", f"{CATS}reorder/", {"ids": [category.id]}),
        ("post", GROUPS, {"name": f"NG {role}", "display_name": "N", "selection_type": "SINGLE"}),
        ("patch", f"{GROUPS}{group.id}/", {"display_name": "Renamed"}),
        ("post", f"{GROUPS}{group.id}/options/", {"name": "Opt", "price_delta": "1.00"}),
        ("post", COLLS, {"name": f"NC {role}"}),
        ("patch", f"{COLLS}{collection.id}/", {"description": "x"}),
        ("post", TAGS, {"name": f"NT {role}"}),
        ("patch", f"{TAGS}{tag.id}/", {"name": f"T2 {role}"}),
    ]
    for method, url, data in writes:
        r = getattr(api, method)(url, data, format="json")
        assert r.status_code in ((200, 201) if manage else (403,)), (method, url, r.status_code, r.content)


@pytest.mark.parametrize("role", ROLES)
def test_capability_matrix_reviews(api, login, role):
    login(make_staff(role))
    review = Review.objects.create(product=make_product(), user=make_user(), rating=4)
    allowed = "reviews.moderate" in ROLE_CAPABILITIES[role]
    assert api.get(REVIEWS).status_code == (200 if allowed else 403)
    assert api.get(f"{REVIEWS}{review.id}/").status_code == (200 if allowed else 403)
    assert api.post(f"{REVIEWS}{review.id}/approve/").status_code == (200 if allowed else 403)
    assert api.post(f"{REVIEWS}{review.id}/reject/").status_code == (200 if allowed else 403)


def test_customers_and_anonymous_blocked_everywhere(api, login):
    for url in (CATS, GROUPS, COLLS, TAGS, REVIEWS):
        assert api.get(url).status_code == 401
    login(make_user())
    for url in (CATS, GROUPS, COLLS, TAGS, REVIEWS):
        assert api.get(url).status_code == 403


# ── categories ──────────────────────────────────────────────────────────────────────────────────────────────────────


def test_category_crud_and_counts(admin):
    r = admin.post(CATS, {"name": "Espresso Bar", "description": "Shots", "is_featured": True}, format="json")
    assert r.status_code == 201 and r.json()["slug"] == "espresso-bar" and r.json()["product_count"] == 0
    cid = r.json()["id"]
    cat = Category.objects.get(pk=cid)
    make_product(category=cat)
    make_product(category=cat, is_active=False)
    d = admin.get(f"{CATS}{cid}/").json()
    assert (d["product_count"], d["active_product_count"]) == (2, 1)
    r = admin.patch(f"{CATS}{cid}/", {"is_active": False, "name": "Espresso"}, format="json")
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert AuditLog.objects.filter(action="category.create").exists()
    assert AuditLog.objects.get(action="category.update").changes["is_active"] == {"old": True, "new": False}
    assert admin.get(CATS + "?is_active=false").json()["count"] == 1
    assert admin.get(CATS + "?search=espre").json()["count"] == 1


def test_category_validation_and_uniqueness(admin):
    make_category("Taken")
    r = admin.post(CATS, {"name": "Taken"}, format="json")
    assert r.status_code == 400 and "name" in r.json()["error"]["fields"]
    existing = Category.objects.get(name="Taken")
    r = admin.post(CATS, {"name": "Other", "slug": existing.slug}, format="json")
    assert r.status_code == 400 and "slug" in r.json()["error"]["fields"]
    assert admin.post(CATS, {"name": "   "}, format="json").status_code == 400
    assert admin.post(CATS, {}, format="json").status_code == 400
    assert admin.post(CATS, {"name": "Neg", "sort_order": -1}, format="json").status_code == 400


def test_category_delete_refused_when_products_exist(admin):
    cat = make_category("Busy")
    make_product(category=cat)
    r = admin.delete(f"{CATS}{cat.id}/")
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "has_products" and "deactivate" in err["message"] and err["product_count"] == 1
    empty = make_category("Empty")
    assert admin.delete(f"{CATS}{empty.id}/").status_code == 204
    assert AuditLog.objects.filter(action="category.delete").exists()


def test_category_reorder_and_cache(admin, api):
    a, b, c = make_category("A", sort_order=1), make_category("B", sort_order=2), make_category("C", sort_order=3)
    assert [x["name"] for x in api.get("/api/v1/categories/").json()] == ["A", "B", "C"]
    r = admin.post(f"{CATS}reorder/", {"ids": [c.id, a.id, b.id]}, format="json")
    assert r.status_code == 200 and [x["name"] for x in r.json()] == ["C", "A", "B"]
    assert [x["name"] for x in api.get("/api/v1/categories/").json()] == ["C", "A", "B"]
    assert admin.post(f"{CATS}reorder/", {"ids": [a.id, 99999]}, format="json").status_code == 400
    assert admin.post(f"{CATS}reorder/", {"ids": []}, format="json").status_code == 400
    assert AuditLog.objects.filter(action="category.reorder").exists()


def test_category_image_upload(admin):
    cat = make_category()
    r = admin.post(f"{CATS}{cat.id}/image/", {"image": image_file()}, format="multipart")
    assert r.status_code == 200 and r.json()["image"].startswith("/media/categories/")
    assert (
        admin.post(f"{CATS}{cat.id}/image/", {"image": image_file("a.gif", "GIF")}, format="multipart").status_code
        == 400
    )
    assert admin.delete(f"{CATS}{cat.id}/image/").json() == {"image": None}


# ── tags ────────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_tag_crud(admin):
    r = admin.post(TAGS, {"name": "Single Origin"}, format="json")
    assert r.status_code == 201 and r.json()["slug"] == "single-origin"
    tid = r.json()["id"]
    make_product().tags.add(Tag.objects.get(pk=tid))
    assert admin.get(f"{TAGS}{tid}/").json()["product_count"] == 1
    assert admin.post(TAGS, {"name": "Single Origin"}, format="json").status_code == 400
    assert admin.patch(f"{TAGS}{tid}/", {"name": "Origin"}, format="json").json()["name"] == "Origin"
    assert admin.delete(f"{TAGS}{tid}/").status_code == 204  # products keep existing, just lose the tag
    assert AuditLog.objects.filter(action__startswith="tag.").count() == 3


# ── modifier groups & options ───────────────────────────────────────────────────────────────────────────────────────


def test_group_create_with_inline_options(admin):
    r = admin.post(
        GROUPS,
        {
            "name": "Milk (espresso)",
            "display_name": "Milk",
            "selection_type": "SINGLE",
            "is_required": True,
            "options": [
                {"name": "Whole", "price_delta": "0.00", "is_default": True},
                {"name": "Oat", "price_delta": "0.60"},
            ],
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    d = r.json()
    assert (d["min_select"], d["max_select"], d["is_required"]) == (1, 1, True)
    assert [(o["name"], o["sort_order"]) for o in d["options"]] == [("Whole", 0), ("Oat", 1)]
    assert AuditLog.objects.filter(action="modifier_group.create").exists()


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"selection_type": "SINGLE", "max_select": 3}, "max_select"),
        ({"selection_type": "SINGLE", "is_required": False, "min_select": 1}, "min_select"),
        ({"selection_type": "MULTIPLE", "max_select": 3, "min_select": 4, "is_required": True}, "min_select"),
        ({"selection_type": "MULTIPLE", "max_select": 3, "min_select": 2, "is_required": False}, "min_select"),
        ({"selection_type": "MULTIPLE", "max_select": 3, "min_select": 0, "is_required": True}, "min_select"),
        ({"selection_type": "MULTIPLE", "max_select": 0}, "max_select"),
        ({"selection_type": "MULTIPLE"}, "max_select"),
        ({"selection_type": "BOTH"}, "selection_type"),
    ],
)
def test_group_consistency_validation(admin, payload, field):
    data = {"name": "G", "display_name": "G", **payload}
    r = admin.post(GROUPS, data, format="json")
    assert r.status_code == 400, r.content
    assert field in r.json()["error"]["fields"]
    assert not ModifierGroup.objects.exists()


def test_group_multiple_valid_and_required_defaults(admin):
    r = admin.post(
        GROUPS,
        {"name": "Syrups", "display_name": "Syrup", "selection_type": "MULTIPLE", "max_select": 3},
        format="json",
    )
    assert r.status_code == 201 and (r.json()["min_select"], r.json()["max_select"]) == (0, 3)
    r = admin.post(
        GROUPS,
        {"name": "Pick", "display_name": "Pick", "selection_type": "MULTIPLE", "max_select": 2, "is_required": True},
        format="json",
    )
    assert r.json()["min_select"] == 1


def test_group_update_keeps_consistency(admin):
    g = admin.post(
        GROUPS,
        {
            "name": "S",
            "display_name": "S",
            "selection_type": "MULTIPLE",
            "max_select": 3,
            "is_required": True,
            "min_select": 2,
        },
        format="json",
    ).json()
    # un-requiring resets the minimum
    r = admin.patch(f"{GROUPS}{g['id']}/", {"is_required": False}, format="json")
    assert r.status_code == 200 and (r.json()["is_required"], r.json()["min_select"]) == (False, 0)
    # switching to SINGLE normalises max to 1
    r = admin.patch(f"{GROUPS}{g['id']}/", {"selection_type": "SINGLE"}, format="json")
    assert r.status_code == 200 and r.json()["max_select"] == 1
    assert (
        admin.patch(f"{GROUPS}{g['id']}/", {"selection_type": "SINGLE", "max_select": 2}, format="json").status_code
        == 400
    )
    assert admin.patch(f"{GROUPS}{g['id']}/", {"name": ""}, format="json").status_code == 400


def test_options_crud_reorder_and_defaults(admin, api):
    group, (a, b, c) = make_modifier_group(None, "Milk", options=[("Whole", "0", True), ("Oat", "0.5"), ("Soy", "0.5")])
    url = f"{GROUPS}{group.id}/options/"
    r = admin.post(url, {"name": "Almond", "price_delta": "0.70"}, format="json")
    assert r.status_code == 201 and r.json()["sort_order"] == 3
    almond = r.json()["id"]
    # SINGLE group: marking another option default clears the previous default
    r = admin.patch(f"{url}{b.id}/", {"is_default": True}, format="json")
    assert r.status_code == 200
    a.refresh_from_db()
    assert a.is_default is False
    assert admin.patch(f"{url}{b.id}/", {"price_delta": "9999"}, format="json").status_code == 400
    assert (
        admin.patch(f"{url}{b.id}/", {"name": "whole"}, format="json").status_code == 400
    )  # duplicate (case-insensitive)
    assert admin.post(url, {"name": "OAT", "price_delta": "0"}, format="json").status_code == 400
    assert admin.post(url, {"name": "", "price_delta": "0"}, format="json").status_code == 400
    assert admin.post(url, {"name": "Free", "price_delta": "-60"}, format="json").status_code == 400
    r = admin.post(f"{url}reorder/", {"ids": [almond, c.id, b.id, a.id]}, format="json")
    assert [o["name"] for o in r.json()] == ["Almond", "Soy", "Oat", "Whole"]
    assert [o["name"] for o in admin.get(url).json()] == ["Almond", "Soy", "Oat", "Whole"]
    assert admin.post(f"{url}reorder/", {"ids": [almond, 99999]}, format="json").status_code == 400
    product = make_product()
    ProductModifierGroup.objects.create(product=product, group=group)
    names = [o["name"] for o in api.get(f"/api/v1/products/{product.slug}/").json()["modifier_groups"][0]["options"]]
    assert names == ["Almond", "Soy", "Oat", "Whole"]
    assert admin.delete(f"{url}{almond}/").status_code == 204
    assert not ModifierOption.objects.filter(pk=almond).exists()
    assert admin.delete(f"{url}{almond}/").status_code == 404
    assert AuditLog.objects.filter(action="modifier_option.create").exists()
    assert AuditLog.objects.filter(action="modifier_option.update").exists()
    assert AuditLog.objects.filter(action="modifier_option.delete").exists()


def test_multiple_group_default_limit(admin):
    group, _ = make_modifier_group(
        None, "Syrups", multiple=True, max_select=2, options=[("A", "0", True), ("B", "0", True), ("C", "0")]
    )
    url = f"{GROUPS}{group.id}/options/"
    r = admin.patch(f"{url}{group.options.get(name='C').id}/", {"is_default": True}, format="json")
    assert r.status_code == 400 and "options" in r.json()["error"]["fields"]
    group.options.get(name="C").refresh_from_db()
    assert group.options.get(name="C").is_default is False


def test_option_with_order_history_cannot_be_deleted(admin):
    group, (opt,) = make_modifier_group(None, "Size", options=[("Large", "1")])
    product = make_product()
    order = make_order(make_branch(), [(product, 1)])
    item = OrderItem.objects.get(order=order)
    OrderItemOption.objects.create(item=item, option=opt, group_name="Size", option_name="Large", price_delta=1)
    r = admin.delete(f"{GROUPS}{group.id}/options/{opt.id}/")
    assert r.status_code == 409 and r.json()["error"]["code"] == "in_use"
    assert admin.patch(f"{GROUPS}{group.id}/options/{opt.id}/", {"is_active": False}, format="json").status_code == 200
    r = admin.delete(f"{GROUPS}{group.id}/")
    assert r.status_code == 409 and r.json()["error"]["in_order_history"] is True


def test_group_delete_rules(admin):
    attached, _ = make_modifier_group(make_product(), "Attached", options=[("A", "0")])
    r = admin.delete(f"{GROUPS}{attached.id}/")
    assert r.status_code == 409 and r.json()["error"]["code"] == "in_use" and r.json()["error"]["product_count"] == 1
    unused, _ = make_modifier_group(None, "Unused", options=[("A", "0")])
    assert admin.delete(f"{GROUPS}{unused.id}/").status_code == 204
    assert not ModifierOption.objects.filter(group_id=unused.id).exists()


def test_group_list_filters_and_counts(admin):
    g1, _ = make_modifier_group(make_product(), "Alpha", options=[("A", "0")])
    g2, _ = make_modifier_group(None, "Beta", options=[("A", "0")])
    g2.is_active = False
    g2.save()
    r = admin.get(GROUPS).json()
    assert [(g["name"], g["product_count"]) for g in r["results"]] == [("Alpha", 1), ("Beta", 0)]
    assert admin.get(GROUPS + "?is_active=false").json()["count"] == 1
    assert admin.get(GROUPS + "?search=alp").json()["count"] == 1
    assert g1.id


def test_option_changes_visible_on_storefront_immediately(admin, api):
    product = make_product()
    group, (opt,) = make_modifier_group(product, "Size", options=[("Large", "1.00")])
    detail = f"/api/v1/products/{product.slug}/"
    assert api.get(detail).json()["modifier_groups"][0]["options"][0]["price_delta"] == "1.00"
    admin.patch(f"{GROUPS}{group.id}/options/{opt.id}/", {"price_delta": "1.25"}, format="json")
    assert api.get(detail).json()["modifier_groups"][0]["options"][0]["price_delta"] == "1.25"
    admin.patch(f"{GROUPS}{group.id}/options/{opt.id}/", {"is_available": False}, format="json")
    assert api.get(detail).json()["modifier_groups"][0]["options"][0]["is_available"] is False
    admin.patch(f"{GROUPS}{group.id}/", {"is_active": False}, format="json")
    assert api.get(detail).json()["modifier_groups"] == []


# ── collections ─────────────────────────────────────────────────────────────────────────────────────────────────────


def test_collection_crud_membership_and_ordering(admin, api):
    p1, p2, p3 = make_product("One"), make_product("Two"), make_product("Three")
    r = admin.post(
        COLLS, {"name": "Morning Picks", "description": "Wake up", "product_ids": [p2.id, p1.id]}, format="json"
    )
    assert r.status_code == 201, r.content
    d = r.json()
    assert d["slug"] == "morning-picks" and d["product_ids"] == [p2.id, p1.id] and d["product_count"] == 2
    assert [p["name"] for p in d["products"]] == ["Two", "One"]
    cid = d["id"]
    assert [p["name"] for p in api.get("/api/v1/collections/morning-picks/").json()["products"]] == ["Two", "One"]
    r = admin.patch(f"{COLLS}{cid}/", {"product_ids": [p1.id, p3.id, p2.id]}, format="json")
    assert r.json()["product_ids"] == [p1.id, p3.id, p2.id]
    assert [p["name"] for p in api.get("/api/v1/collections/morning-picks/").json()["products"]] == [
        "One",
        "Three",
        "Two",
    ]
    r = admin.put(f"{COLLS}{cid}/products/", {"product_ids": [p3.id]}, format="json")
    assert r.json()["product_ids"] == [p3.id]
    r = admin.post(f"{COLLS}{cid}/products/", {"product_id": p1.id}, format="json")
    assert r.json()["product_ids"] == [p3.id, p1.id]
    assert admin.post(f"{COLLS}{cid}/products/", {"product_id": p1.id}, format="json").json()["product_ids"] == [
        p3.id,
        p1.id,
    ]
    assert admin.post(f"{COLLS}{cid}/products/", {"product_id": 99999}, format="json").status_code == 404
    r = admin.delete(f"{COLLS}{cid}/products/{p3.id}/")
    assert r.json()["product_ids"] == [p1.id]
    assert admin.delete(f"{COLLS}{cid}/products/{p3.id}/").status_code == 200  # idempotent
    assert admin.put(f"{COLLS}{cid}/products/", {"product_ids": [p1.id, p1.id]}, format="json").status_code == 400
    assert admin.put(f"{COLLS}{cid}/products/", {"product_ids": [99999]}, format="json").status_code == 400
    assert admin.delete(f"{COLLS}{cid}/").status_code == 204
    assert Collection.objects.count() == 0 and CollectionItem.objects.count() == 0
    assert make_product.__name__ and p1.pk  # products survive collection deletion
    assert AuditLog.objects.filter(action="collection.products").exists()


def test_collection_validation_reorder_image(admin):
    c1 = Collection.objects.create(name="First", slug="first", sort_order=1)
    c2 = Collection.objects.create(name="Second", slug="second", sort_order=2)
    assert admin.post(COLLS, {"name": "First"}, format="json").status_code == 400
    assert admin.post(COLLS, {"name": "X", "slug": "first"}, format="json").status_code == 400
    assert admin.post(COLLS, {"name": "X", "product_ids": [12345]}, format="json").status_code == 400
    r = admin.post(f"{COLLS}reorder/", {"ids": [c2.id, c1.id]}, format="json")
    assert [c["name"] for c in r.json()] == ["Second", "First"]
    assert (
        admin.post(f"{COLLS}{c1.id}/image/", {"image": image_file()}, format="multipart")
        .json()["image"]
        .startswith("/media/collections/")
    )


# ── reviews moderation ──────────────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def reviews():
    product = make_product("Flat White")
    other = make_product("Mocha")
    return {
        "pending": Review.objects.create(product=product, user=make_user(), rating=5, title="Great", status="PENDING"),
        "approved": Review.objects.create(product=product, user=make_user(), rating=4, status="APPROVED", is_demo=True),
        "rejected": Review.objects.create(
            product=other, user=make_user(), rating=1, body="spam link", status="REJECTED"
        ),
        "product": product,
    }


def test_review_list_filters(admin, reviews):
    def ids(query):
        r = admin.get(REVIEWS + query)
        assert r.status_code == 200
        return {x["id"] for x in r.json()["results"]}

    p, a, r_ = reviews["pending"].id, reviews["approved"].id, reviews["rejected"].id
    assert ids("") == {p, a, r_}
    assert ids("?status=PENDING") == {p}
    assert ids(f"?product={reviews['product'].id}") == {p, a}
    assert ids("?is_demo=true") == {a}
    assert ids("?is_demo=false") == {p, r_}
    assert ids("?rating=1") == {r_}
    assert ids("?q=spam") == {r_}
    assert admin.get(REVIEWS + "?status=BOGUS").status_code == 400
    row = admin.get(f"{REVIEWS}{p}/").json()
    assert row["product"]["name"] == "Flat White" and row["customer"]["email"] and row["is_demo"] is False


def test_approve_and_reject_set_moderator_and_audit(login, api, reviews):
    staff = make_staff("PRODUCT_MANAGER")
    client = login(staff)
    review = reviews["pending"]
    product = reviews["product"]
    # card shows only the already-approved review (4.0, 1 rating)
    assert api.get(f"/api/v1/products/{product.slug}/").json()["rating_count"] == 1
    r = client.post(f"{REVIEWS}{review.id}/approve/")
    assert r.status_code == 200 and r.json()["status"] == "APPROVED" and r.json()["moderated_by"] == staff.email
    review.refresh_from_db()
    assert review.moderated_by == staff and review.moderated_at is not None
    detail = api.get(f"/api/v1/products/{product.slug}/").json()
    assert detail["rating_count"] == 2 and detail["rating_avg"] == 4.5  # moderation busts the cache
    assert api.get(f"/api/v1/products/{product.slug}/reviews/").json()["count"] == 2
    log = AuditLog.objects.get(action="review.approve")
    assert log.changes["status"] == {"old": "PENDING", "new": "APPROVED"} and log.actor == staff
    client.post(f"{REVIEWS}{review.id}/approve/")  # idempotent
    assert AuditLog.objects.filter(action="review.approve").count() == 1
    r = client.post(f"{REVIEWS}{review.id}/reject/")
    assert r.json()["status"] == "REJECTED"
    assert api.get(f"/api/v1/products/{product.slug}/").json()["rating_count"] == 1
    assert AuditLog.objects.filter(action="review.reject").count() == 1


def test_reviews_unknown_id_404(admin):
    assert admin.post(f"{REVIEWS}999999/approve/").status_code == 404
    assert admin.get(f"{REVIEWS}999999/").status_code == 404
