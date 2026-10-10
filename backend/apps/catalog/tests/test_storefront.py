import pytest
from django.urls import reverse

from apps.catalog.models import Collection, CollectionItem, ProductImage, Review, Tag
from apps.inventory.models import BranchProduct
from tests.factories import make_branch, make_category, make_modifier_group, make_product, make_stock, make_user

pytestmark = pytest.mark.django_db

PRODUCTS = "/api/v1/products/"


def names(response):
    return [p["name"] for p in response.json()["results"]]


@pytest.fixture
def menu():
    espresso = make_category("Espresso", sort_order=1)
    brewed = make_category("Brewed", sort_order=2)
    beans = make_category("Beans", sort_order=3)
    items = {
        "flat": make_product(
            "Flat White", "4.50", espresso, is_featured=True, is_bestseller=True, short_description="Silky"
        ),
        "cap": make_product("Cappuccino", "4.20", espresso, sort_order=2, allergens=["milk"]),
        "latte": make_product("Iced Caramel Latte", "5.20", espresso, sort_order=3, is_seasonal=True),
        "pour": make_product("Pour Over", "5.00", brewed, description="Hand-poured single origin filter coffee"),
        "ethiopia": make_product("Ethiopia Guji", "16.00", beans, stocked=True, product_type="BEANS", is_new=True),
    }
    return items


# ── categories ──────────────────────────────────────────────────────────────────────────────────────────────────────


def test_categories_active_only_with_counts_and_order(api):
    a = make_category("Zeta", sort_order=1)
    b = make_category("Alpha", sort_order=2)
    make_category("Hidden", is_active=False)
    make_product(category=a)
    make_product(category=a)
    make_product(category=a, is_active=False)
    r = api.get("/api/v1/categories/")
    assert r.status_code == 200
    data = r.json()
    assert [c["name"] for c in data] == ["Zeta", "Alpha"]
    assert data[0]["product_count"] == 2 and data[1]["product_count"] == 0
    assert set(data[0]) == {"id", "slug", "name", "description", "image", "is_featured", "sort_order", "product_count"}
    assert b.name == "Alpha"


# ── list & filters ─────────────────────────────────────────────────────────────────────────────────────────────────


def test_list_default_menu_order_and_card_shape(api, menu):
    r = api.get(PRODUCTS)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 5 and body["next"] is None and body["previous"] is None
    assert names(r) == ["Flat White", "Cappuccino", "Iced Caramel Latte", "Pour Over", "Ethiopia Guji"]
    card = body["results"][0]
    assert set(card) == {
        "id",
        "slug",
        "name",
        "short_description",
        "base_price",
        "image",
        "category",
        "flags",
        "product_type",
        "stock_mode",
        "allergens",
        "tags",
        "rating_avg",
        "rating_count",
        "has_options",
        "is_available",
        "unavailable_reason",
    }
    assert card["base_price"] == "4.50"
    assert card["category"] == {"slug": menu["flat"].category.slug, "name": "Espresso"}
    assert card["flags"] == {"is_featured": True, "is_bestseller": True, "is_seasonal": False, "is_new": False}
    assert card["image"] is None and card["rating_avg"] is None and card["rating_count"] == 0
    assert card["has_options"] is False and card["is_available"] is True and card["unavailable_reason"] is None


def test_inactive_products_and_inactive_categories_never_visible(api, menu):
    menu["cap"].is_active = False
    menu["cap"].save()
    hidden_cat = make_category("Secret", is_active=False)
    make_product("Ghost", category=hidden_cat)
    r = api.get(PRODUCTS)
    assert "Cappuccino" not in names(r) and "Ghost" not in names(r)
    assert api.get(PRODUCTS + "?q=ghost").json()["count"] == 0
    assert api.get(PRODUCTS + "?category=" + hidden_cat.slug).json()["count"] == 0


def test_image_urls_are_root_relative(api):
    make_product("Pic", image="products/pic.webp")
    assert api.get(PRODUCTS).json()["results"][0]["image"] == "/media/products/pic.webp"


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("featured=true", ["Flat White"]),
        ("bestseller=true", ["Flat White"]),
        ("seasonal=true", ["Iced Caramel Latte"]),
        ("new=true", ["Ethiopia Guji"]),
        ("type=BEANS", ["Ethiopia Guji"]),
        ("min_price=5", ["Iced Caramel Latte", "Pour Over", "Ethiopia Guji"]),
        ("max_price=4.50", ["Flat White", "Cappuccino"]),
        ("min_price=4.5&max_price=5", ["Flat White", "Pour Over"]),
        ("featured=false", ["Cappuccino", "Iced Caramel Latte", "Pour Over", "Ethiopia Guji"]),
    ],
)
def test_filters(api, menu, query, expected):
    assert names(api.get(f"{PRODUCTS}?{query}")) == expected


def test_filter_by_category_collection_tag(api, menu):
    slug = menu["pour"].category.slug
    assert names(api.get(f"{PRODUCTS}?category={slug}")) == ["Pour Over"]
    col = Collection.objects.create(name="Signature", slug="signature")
    CollectionItem.objects.create(collection=col, product=menu["cap"], sort_order=2)
    CollectionItem.objects.create(collection=col, product=menu["flat"], sort_order=1)
    assert names(api.get(f"{PRODUCTS}?collection=signature")) == ["Flat White", "Cappuccino"]
    col.is_active = False
    col.save()
    assert api.get(f"{PRODUCTS}?collection=signature").json()["count"] == 0
    tag = Tag.objects.create(name="Single origin", slug="single-origin")
    menu["pour"].tags.add(tag)
    r = api.get(f"{PRODUCTS}?tag=single-origin")
    assert names(r) == ["Pour Over"] and r.json()["results"][0]["tags"] == [
        {"slug": "single-origin", "name": "Single origin"}
    ]


def test_filter_by_ids_resolves_saved_products(api, menu):
    ids = f"{menu['pour'].id},{menu['cap'].id},{menu['ethiopia'].id}"
    assert sorted(names(api.get(f"{PRODUCTS}?ids={ids}"))) == ["Cappuccino", "Ethiopia Guji", "Pour Over"]
    # junk entries are ignored, unknown ids simply do not match, and inactive products never leak
    hidden = make_product("Archived", "3.00", menu["pour"].category, is_active=False)
    r = api.get(f"{PRODUCTS}?ids={menu['flat'].id},abc,,999999,{hidden.id}")
    assert names(r) == ["Flat White"]
    assert api.get(f"{PRODUCTS}?ids=abc").json()["count"] == 0


def test_invalid_filter_values_are_400(api, menu):
    assert api.get(PRODUCTS + "?type=NOPE").status_code == 400
    assert api.get(PRODUCTS + "?min_price=abc").status_code == 400
    assert api.get(PRODUCTS + "?ordering=hacker").status_code == 400
    assert api.get(PRODUCTS + "?branch=missing").status_code == 400


def test_ordering(api, menu):
    assert names(api.get(PRODUCTS + "?ordering=price"))[:2] == ["Cappuccino", "Flat White"]
    assert names(api.get(PRODUCTS + "?ordering=-price"))[0] == "Ethiopia Guji"
    assert names(api.get(PRODUCTS + "?ordering=name"))[0] == "Cappuccino"
    assert names(api.get(PRODUCTS + "?ordering=-name"))[0] == "Pour Over"
    assert names(api.get(PRODUCTS + "?ordering=popularity"))[0] == "Flat White"


def test_pagination_envelope_and_links(api):
    cat = make_category()
    for i in range(5):
        make_product(f"P{i}", category=cat, sort_order=i)
    r = api.get(PRODUCTS + "?page_size=2&page=2&ordering=name").json()
    assert r["count"] == 5 and [p["name"] for p in r["results"]] == ["P2", "P3"]
    assert "page=3" in r["next"] and "page=1" in r["previous"] and "ordering=name" in r["next"]
    assert api.get(PRODUCTS + "?page_size=2&page=4").status_code == 404
    assert api.get(PRODUCTS + "?page=0").status_code == 404
    assert api.get(PRODUCTS + "?page=x").status_code == 404
    last = api.get(PRODUCTS + "?page_size=2&page=3").json()
    assert last["next"] is None and len(last["results"]) == 1


def test_ratings_count_only_approved_reviews(api, menu):
    flat = menu["flat"]
    for rating, status in ((5, "APPROVED"), (4, "APPROVED"), (1, "PENDING"), (1, "REJECTED")):
        Review.objects.create(product=flat, user=make_user(), rating=rating, status=status)
    card = api.get(PRODUCTS).json()["results"][0]
    assert card["rating_avg"] == 4.5 and card["rating_count"] == 2


def test_has_options_requires_an_active_group_with_an_active_option(api):
    with_opts, without, inactive = make_product("A"), make_product("B"), make_product("C")
    make_modifier_group(with_opts, "Size", options=[("S", "0"), ("L", "1")])
    group, _ = make_modifier_group(without, "Empty", options=[])
    group2, opts = make_modifier_group(inactive, "Milk", options=[("Oat", "0.5")])
    opts[0].is_active = False
    opts[0].save()
    flags = {p["name"]: p["has_options"] for p in api.get(PRODUCTS).json()["results"]}
    assert flags == {"A": True, "B": False, "C": False}


# ── branch-aware availability ───────────────────────────────────────────────────────────────────────────────────────


def test_branch_availability_overlay_is_never_cached_across_branches(api, menu):
    downtown, uptown = make_branch(slug="downtown"), make_branch(slug="uptown")
    BranchProduct.objects.create(branch=downtown, product=menu["cap"], is_available=False)
    make_stock(uptown, menu["ethiopia"], 3)
    menu["pour"].is_sold_out = True
    menu["pour"].save()

    def by_name(url):
        return {p["name"]: (p["is_available"], p["unavailable_reason"]) for p in api.get(url).json()["results"]}

    global_view = by_name(PRODUCTS)
    assert global_view["Cappuccino"] == (True, None)
    assert global_view["Ethiopia Guji"] == (True, None)  # no branch: global flags only
    assert global_view["Pour Over"] == (False, "sold_out")
    d = by_name(PRODUCTS + "?branch=downtown")
    assert d["Cappuccino"] == (False, "branch_unavailable")
    assert d["Ethiopia Guji"] == (False, "out_of_stock")
    assert d["Pour Over"] == (False, "sold_out")
    u = by_name(f"{PRODUCTS}?branch={uptown.id}")
    assert u["Cappuccino"] == (True, None) and u["Ethiopia Guji"] == (True, None)
    assert by_name(PRODUCTS)["Cappuccino"] == (True, None)  # still clean after branch requests


def test_inactive_branch_is_unknown(api, menu):
    make_branch(slug="closed-down", is_active=False)
    assert api.get(PRODUCTS + "?branch=closed-down").status_code == 400


# ── detail ─────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_detail_payload(api, menu):
    flat = menu["flat"]
    flat.calories, flat.caffeine_mg, flat.prep_minutes, flat.nutrition = 120, 130, 4, {"protein_g": 6}
    flat.description = "Two ristretto shots"
    flat.save()
    ProductImage.objects.create(product=flat, image="products/gallery/a.webp", alt_text="A", sort_order=2)
    ProductImage.objects.create(product=flat, image="products/gallery/b.webp", alt_text="B", sort_order=1)
    size, _ = make_modifier_group(flat, "Size", required=True, options=[("Small", "0", True), ("Large", "0.80")])
    milk, milk_opts = make_modifier_group(flat, "Milk", options=[("Oat", "0.50"), ("Soy", "0.50"), ("Gone", "0")])
    milk_opts[2].is_active = False
    milk_opts[2].save()
    milk_opts[1].is_available = False
    milk_opts[1].save()
    inactive_group, _ = make_modifier_group(flat, "Syrup", options=[("Vanilla", "0.5")])
    inactive_group.is_active = False
    inactive_group.save()
    Review.objects.create(product=flat, user=make_user(), rating=5, status="APPROVED")
    Review.objects.create(product=flat, user=make_user(), rating=3, status="APPROVED")
    Review.objects.create(product=flat, user=make_user(), rating=1, status="PENDING")

    r = api.get(f"{PRODUCTS}{flat.slug}/")
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "Flat White" and d["description"] == "Two ristretto shots"
    assert (d["calories"], d["caffeine_mg"], d["prep_minutes"], d["nutrition"]) == (120, 130, 4, {"protein_g": 6})
    assert [g["url"] for g in d["gallery"]] == ["/media/products/gallery/b.webp", "/media/products/gallery/a.webp"]
    assert [g["display_name"] for g in d["modifier_groups"]] == ["Size", "Milk"]
    assert set(d["modifier_groups"][0]) == {
        "id",
        "display_name",
        "selection_type",
        "is_required",
        "min_select",
        "max_select",
        "options",
    }
    assert d["modifier_groups"][0]["is_required"] is True
    assert [o["name"] for o in d["modifier_groups"][1]["options"]] == ["Oat", "Soy"]
    assert d["modifier_groups"][1]["options"][1]["is_available"] is False
    assert d["modifier_groups"][0]["options"][0] == {
        "id": d["modifier_groups"][0]["options"][0]["id"],
        "name": "Small",
        "price_delta": "0.00",
        "is_default": True,
        "is_available": True,
    }
    assert d["reviews"]["count"] == 2 and d["reviews"]["average"] == 4.0
    assert d["reviews"]["distribution"] == [
        {"rating": 5, "count": 1},
        {"rating": 4, "count": 0},
        {"rating": 3, "count": 1},
        {"rating": 2, "count": 0},
        {"rating": 1, "count": 0},
    ]
    assert [p["name"] for p in d["related"]] == ["Cappuccino", "Iced Caramel Latte"]
    assert d["has_options"] is True and d["rating_count"] == 2


def test_detail_groups_without_active_options_are_hidden(api):
    p = make_product()
    make_modifier_group(p, "Empty", options=[])
    assert api.get(f"{PRODUCTS}{p.slug}/").json()["modifier_groups"] == []


def test_detail_related_is_capped_at_four_and_excludes_self_and_inactive(api):
    cat = make_category()
    main = make_product("Main", category=cat)
    for i in range(6):
        make_product(f"Rel{i}", category=cat, sort_order=i)
    make_product("Hidden", category=cat, is_active=False)
    related = [p["name"] for p in api.get(f"{PRODUCTS}{main.slug}/").json()["related"]]
    assert len(related) == 4 and "Main" not in related and "Hidden" not in related


def test_detail_404_for_unknown_inactive_product_or_category(api):
    inactive = make_product(is_active=False)
    in_hidden_cat = make_product(category=make_category(is_active=False))
    for slug in ("nope", inactive.slug, in_hidden_cat.slug):
        r = api.get(f"{PRODUCTS}{slug}/")
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "not_found"


def test_detail_branch_availability_covers_related(api):
    branch = make_branch(slug="main")
    cat = make_category()
    main, sibling = make_product("Main", category=cat), make_product("Sibling", category=cat, sort_order=1)
    BranchProduct.objects.create(branch=branch, product=sibling, is_available=False)
    d = api.get(f"{PRODUCTS}{main.slug}/?branch=main").json()
    assert d["is_available"] is True
    assert d["related"][0]["unavailable_reason"] == "branch_unavailable"
    assert api.get(f"{PRODUCTS}{main.slug}/").json()["related"][0]["unavailable_reason"] is None


# ── suggest, facets, collections, tags ─────────────────────────────────────────────────────────────────────────────


def test_suggest(api, menu):
    r = api.get(PRODUCTS + "suggest/?q=cap")
    assert r.status_code == 200
    assert r.json()[0]["name"] == "Cappuccino"
    assert set(r.json()[0]) == {"slug", "name", "image", "category", "base_price"}
    assert api.get(PRODUCTS + "suggest/?q=c").json() == []
    assert api.get(PRODUCTS + "suggest/").json() == []
    assert api.get(PRODUCTS + "suggest/?q=zzzzzz").json() == []


def test_suggest_returns_at_most_six_active(api):
    cat = make_category()
    for i in range(9):
        make_product(f"Mocha {i}", category=cat)
    make_product("Mocha hidden", category=cat, is_active=False)
    r = api.get(PRODUCTS + "suggest/?q=mocha").json()
    assert len(r) == 6 and all("hidden" not in p["name"] for p in r)


def test_facets(api, menu):
    tag = Tag.objects.create(name="Vegan", slug="vegan")
    menu["pour"].tags.add(tag)
    menu["cap"].tags.add(tag)
    d = api.get(PRODUCTS + "facets/").json()
    assert {c["name"]: c["count"] for c in d["categories"]} == {"Espresso": 3, "Brewed": 1, "Beans": 1}
    assert [c["name"] for c in d["categories"]] == ["Espresso", "Brewed", "Beans"]
    assert d["tags"] == [{"slug": "vegan", "name": "Vegan", "count": 2}]
    assert {t["value"]: t["count"] for t in d["types"]} == {"BEVERAGE": 4, "BEANS": 1}
    assert d["price"] == {"min": "4.20", "max": "16.00"}
    # a facet ignores its own dimension: the category facet still lists other categories under category=…
    slug = menu["pour"].category.slug
    narrowed = api.get(f"{PRODUCTS}facets/?category={slug}&max_price=5").json()
    assert {c["name"]: c["count"] for c in narrowed["categories"]} == {"Espresso": 2, "Brewed": 1}
    # …while the price range ignores the price filters but honours the category
    assert narrowed["price"] == {"min": "5.00", "max": "5.00"}
    assert narrowed["types"] == [{"value": "BEVERAGE", "label": "Beverage", "count": 1}]
    assert api.get(PRODUCTS + "facets/?type=bad").status_code == 400


def test_collections_list_and_detail(api, menu):
    col = Collection.objects.create(name="Morning", slug="morning", sort_order=1)
    off = Collection.objects.create(name="Off", slug="off", is_active=False)
    CollectionItem.objects.create(collection=col, product=menu["pour"], sort_order=2)
    CollectionItem.objects.create(collection=col, product=menu["flat"], sort_order=1)
    CollectionItem.objects.create(collection=col, product=menu["cap"], sort_order=3)
    menu["cap"].is_active = False
    menu["cap"].save()
    CollectionItem.objects.create(collection=off, product=menu["flat"])
    lst = api.get("/api/v1/collections/").json()
    assert [(c["slug"], c["product_count"]) for c in lst] == [("morning", 2)]
    d = api.get("/api/v1/collections/morning/").json()
    assert [p["name"] for p in d["products"]] == ["Flat White", "Pour Over"]
    assert d["product_count"] == 2
    assert api.get("/api/v1/collections/off/").status_code == 404
    assert api.get("/api/v1/collections/missing/").status_code == 404


def test_collection_detail_branch_overlay(api, menu):
    branch = make_branch(slug="b1")
    col = Collection.objects.create(name="Morning", slug="morning")
    CollectionItem.objects.create(collection=col, product=menu["cap"])
    BranchProduct.objects.create(branch=branch, product=menu["cap"], is_available=False)
    d = api.get("/api/v1/collections/morning/?branch=b1").json()
    assert d["products"][0]["unavailable_reason"] == "branch_unavailable"


def test_tags_list_only_tags_on_visible_products(api, menu):
    used, hidden = Tag.objects.create(name="Used", slug="used"), Tag.objects.create(name="Hidden", slug="hidden")
    Tag.objects.create(name="Orphan", slug="orphan")
    menu["pour"].tags.add(used)
    gone = make_product("Gone", is_active=False)
    gone.tags.add(hidden)
    assert [t["name"] for t in api.get("/api/v1/tags/").json()] == ["Used"]


def test_url_names_resolve():
    assert reverse("product-list") == PRODUCTS
