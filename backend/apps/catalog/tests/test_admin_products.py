import pytest
from django.core.cache import cache
from PIL import Image

from apps.accounts.permissions import ROLE_CAPABILITIES
from apps.catalog.models import Category, Collection, CollectionItem, ModifierGroup, Product, ProductImage, Tag
from apps.core.models import AuditLog
from apps.inventory.tests.helpers import make_order
from tests.factories import (
    make_branch,
    make_category,
    make_modifier_group,
    make_product,
    make_staff,
    make_stock,
    make_user,
)

from .helpers import image_file

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/products/"
ROLES = list(ROLE_CAPABILITIES)


@pytest.fixture
def admin(login):
    return login(make_staff("ADMIN"))


def payload(category, **kw):
    base = {
        "name": "Mocha",
        "sku": "MOCHA-1",
        "category": category.id,
        "base_price": "4.80",
        "product_type": "BEVERAGE",
    }
    base.update(kw)
    return base


# ── permissions ─────────────────────────────────────────────────────────────────────────────────────────────────────


def test_anonymous_and_customers_cannot_use_admin_products(api, login):
    assert api.get(URL).status_code == 401
    login(make_user())
    assert api.get(URL).status_code == 403
    assert api.post(URL, {}).status_code == 403


@pytest.mark.parametrize("role", ROLES)
def test_capability_matrix_products(api, login, role):
    login(make_staff(role))
    category = make_category()
    caps = ROLE_CAPABILITIES[role]
    product = make_product(category=category)
    read = 200 if "catalog.view" in caps else 403
    write = "catalog.manage" in caps
    assert api.get(URL).status_code == read
    assert api.get(f"{URL}{product.id}/").status_code == read
    r = api.post(URL, payload(category, sku=f"S-{role}"))
    assert r.status_code == (201 if write else 403), r.content
    assert api.patch(f"{URL}{product.id}/", {"is_featured": True}).status_code == (200 if write else 403)
    assert api.post(f"{URL}{product.id}/archive/").status_code == (200 if write else 403)
    assert api.post(f"{URL}{product.id}/image/", {"image": image_file()}, format="multipart").status_code == (
        200 if write else 403
    )
    assert api.delete(f"{URL}{product.id}/").status_code == (204 if write else 403)


def test_forbidden_error_uses_envelope(api, login):
    login(make_staff("SUPPORT_AGENT"))
    r = api.post(URL, {})
    assert r.status_code == 403 and r.json()["error"]["code"] == "permission_denied"


# ── create / read / update ──────────────────────────────────────────────────────────────────────────────────────────


def test_create_full_product(admin):
    category = make_category()
    size, _ = make_modifier_group(None, "Size", options=[("S", "0"), ("L", "1")])
    milk, _ = make_modifier_group(None, "Milk", options=[("Oat", "0.5")])
    r = admin.post(
        URL,
        payload(
            category,
            short_description="Chocolatey",
            description="Espresso + chocolate",
            is_featured=True,
            stock_mode="PREPARED",
            prep_minutes=4,
            calories=250,
            caffeine_mg=95,
            allergens=["Milk", " tree  nuts ", "milk"],
            nutrition={"protein_g": 8, "serving_size": "12 oz"},
            tags=["Chocolate", "chocolate", "Sweet"],
            modifier_group_ids=[milk.id, size.id],
        ),
        format="json",
    )
    assert r.status_code == 201, r.content
    d = r.json()
    assert d["slug"] == "mocha"  # generated
    assert d["allergens"] == ["milk", "tree nuts"]
    assert d["tags"] == ["Chocolate", "Sweet"]
    assert d["modifier_group_ids"] == [milk.id, size.id]
    assert [g["display_name"] for g in d["modifier_groups"]] == ["Milk", "Size"]
    assert d["image"] is None and d["gallery"] == [] and d["is_demo"] is False and d["category_name"] == category.name
    p = Product.objects.get(sku="MOCHA-1")
    assert (p.prep_minutes, p.calories, p.is_featured, p.nutrition) == (
        4,
        250,
        True,
        {"protein_g": 8, "serving_size": "12 oz"},
    )
    assert Tag.objects.count() == 2
    log = AuditLog.objects.get(action="product.create")
    assert log.resource_id == str(p.pk) and log.changes["new"]["sku"] == "MOCHA-1" and log.actor.email


def test_slug_auto_generation_is_unique(admin):
    category = make_category()
    first = admin.post(URL, payload(category, name="Cold Brew", sku="CB-1"), format="json").json()
    second = admin.post(URL, payload(category, name="Cold Brew", sku="CB-2"), format="json").json()
    assert (first["slug"], second["slug"]) == ("cold-brew", "cold-brew-2")


def test_unique_sku_and_slug_are_field_errors(admin):
    category = make_category()
    existing = make_product(category=category, name="Taken")
    r = admin.post(URL, payload(category, sku=existing.sku), format="json")
    assert r.status_code == 400
    body = r.json()["error"]
    assert body["code"] == "validation_error" and "sku" in body["fields"]
    r = admin.post(URL, payload(category, sku="NEW-1", slug=existing.slug), format="json")
    assert r.status_code == 400 and "slug" in r.json()["error"]["fields"]
    other = make_product(category=category)
    r = admin.patch(f"{URL}{other.id}/", {"slug": existing.slug, "sku": existing.sku}, format="json")
    assert r.status_code == 400 and set(r.json()["error"]["fields"]) == {"slug", "sku"}
    # keeping its own values is fine
    assert admin.patch(f"{URL}{other.id}/", {"slug": other.slug, "sku": other.sku}, format="json").status_code == 200


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", ""),
        ("name", "   "),
        ("base_price", "-1"),
        ("base_price", "abc"),
        ("base_price", "123456789"),
        ("category", 999999),
        ("product_type", "DRONE"),
        ("stock_mode", "X"),
        ("allergens", ["bad!"]),
        ("allergens", ["x"] * 25),
        ("nutrition", {"Bad Key": 1}),
        ("nutrition", {"fat_g": -1}),
        ("nutrition", {"fat_g": True}),
        ("nutrition", {"a": {"b": 1}}),
        ("nutrition", [1, 2]),
        ("tags", [""]),
        ("tags", ["!!!"]),
        ("modifier_group_ids", [999999]),
        ("calories", -5),
        ("slug", "Not A Slug!"),
    ],
)
def test_create_validation(admin, field, value):
    category = make_category()
    data = payload(category)
    data[field] = value
    r = admin.post(URL, data, format="json")
    assert r.status_code == 400, (field, value, r.content)
    assert r.json()["error"]["code"] == "validation_error"
    assert not Product.objects.exists()


def test_required_fields(admin):
    r = admin.post(URL, {}, format="json")
    assert r.status_code == 400
    assert {"name", "sku", "category", "base_price"} <= set(r.json()["error"]["fields"])


def test_modifier_group_ids_order_and_replacement(admin):
    product = make_product()
    g1, _ = make_modifier_group(None, "G1", options=[("a", "0")])
    g2, _ = make_modifier_group(None, "G2", options=[("a", "0")])
    g3, _ = make_modifier_group(None, "G3", options=[("a", "0")])
    r = admin.patch(f"{URL}{product.id}/", {"modifier_group_ids": [g3.id, g1.id]}, format="json")
    assert r.json()["modifier_group_ids"] == [g3.id, g1.id]
    r = admin.patch(f"{URL}{product.id}/", {"modifier_group_ids": [g1.id, g2.id, g3.id]}, format="json")
    assert r.json()["modifier_group_ids"] == [g1.id, g2.id, g3.id]
    assert admin.patch(f"{URL}{product.id}/", {"name": "X"}, format="json").json()["modifier_group_ids"] == [
        g1.id,
        g2.id,
        g3.id,
    ]
    assert admin.patch(f"{URL}{product.id}/", {"modifier_group_ids": [g1.id, g1.id]}, format="json").status_code == 400
    assert (
        admin.patch(f"{URL}{product.id}/", {"modifier_group_ids": []}, format="json").json()["modifier_group_ids"] == []
    )
    assert ModifierGroup.objects.count() == 3  # groups themselves untouched


def test_retrieve_and_put(admin):
    product = make_product(name="Original", price="3.00")
    d = admin.get(f"{URL}{product.id}/").json()
    assert d["id"] == product.id and d["name"] == "Original" and d["base_price"] == "3.00"
    d["name"] = "Renamed"
    d["base_price"] = "3.25"
    for k in ("image", "gallery", "modifier_groups", "category_name"):
        d.pop(k)
    r = admin.put(f"{URL}{product.id}/", d, format="json")
    assert r.status_code == 200 and r.json()["name"] == "Renamed" and r.json()["base_price"] == "3.25"
    assert admin.get(f"{URL}999999/").status_code == 404


def test_quick_toggles_via_patch(admin):
    product = make_product()
    r = admin.patch(
        f"{URL}{product.id}/", {"is_active": False, "is_sold_out": True, "is_featured": True}, format="json"
    )
    assert r.status_code == 200
    product.refresh_from_db()
    assert (product.is_active, product.is_sold_out, product.is_featured) == (False, True, True)
    log = AuditLog.objects.get(action="product.update")
    assert set(log.changes) == {"is_active", "is_sold_out", "is_featured"}


def test_price_change_is_audited_with_old_and_new(admin):
    product = make_product(price="4.00")
    admin.patch(f"{URL}{product.id}/", {"base_price": "4.75"}, format="json")
    log = AuditLog.objects.get(action="product.price_change")
    assert log.changes == {"sku": product.sku, "old": "4.00", "new": "4.75"}
    assert "4.00" in log.summary and "4.75" in log.summary
    update = AuditLog.objects.get(action="product.update")
    assert update.changes["base_price"] == {"old": "4.00", "new": "4.75"}
    admin.patch(f"{URL}{product.id}/", {"name": "New name"}, format="json")  # no price entry for unrelated edits
    assert AuditLog.objects.filter(action="product.price_change").count() == 1


def test_update_without_changes_writes_no_audit(admin):
    product = make_product()
    admin.patch(f"{URL}{product.id}/", {"name": product.name}, format="json")
    assert not AuditLog.objects.filter(action="product.update").exists()


def test_tags_replaced_and_audited(admin):
    product = make_product()
    admin.patch(f"{URL}{product.id}/", {"tags": ["A", "B"]}, format="json")
    r = admin.patch(f"{URL}{product.id}/", {"tags": ["B", "C"]}, format="json")
    assert r.json()["tags"] == ["B", "C"]
    last = AuditLog.objects.filter(action="product.update").first()
    assert last.changes["tags"] == {"old": ["A", "B"], "new": ["B", "C"]}


# ── list ────────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_list_filters_search_ordering_and_shape(admin):
    cat_a, cat_b = make_category("A", sort_order=1), make_category("B", sort_order=2)
    latte = make_product("Latte", "4.00", cat_a, is_featured=True)
    mocha = make_product("Mocha", "5.00", cat_a, is_active=False)
    beans = make_product("Beans", "12.00", cat_b, stocked=True, product_type="BEANS", is_sold_out=True)

    def names(query):
        r = admin.get(URL + query)
        assert r.status_code == 200, r.content
        return [p["name"] for p in r.json()["results"]]

    assert names("") == ["Latte", "Mocha", "Beans"]
    assert names("?q=lat") == ["Latte"]
    assert names(f"?q={beans.sku}") == ["Beans"]
    assert names(f"?category={cat_b.id}") == ["Beans"]
    assert names("?active=false") == ["Mocha"]
    assert names("?active=true") == ["Latte", "Beans"]
    assert names("?type=BEANS") == ["Beans"]
    assert names("?stock_mode=STOCKED") == ["Beans"]
    assert names("?is_featured=true") == ["Latte"]
    assert names("?is_sold_out=true") == ["Beans"]
    assert names("?ordering=-base_price") == ["Beans", "Mocha", "Latte"]
    assert names("?ordering=name") == ["Beans", "Latte", "Mocha"]
    assert admin.get(URL + "?type=NOPE").status_code == 400
    row = admin.get(URL + "?q=latte").json()["results"][0]
    assert (
        row["id"] == latte.id
        and row["category_name"] == "A"
        and row["stock_total"] is None
        and row["low_stock"] is False
    )
    assert mocha.id and admin.get(URL + "?page_size=2").json()["count"] == 3


def test_list_low_stock_filter_and_stock_totals(admin):
    b1, b2 = make_branch(), make_branch()
    low = make_product("Low", stocked=True)
    ok = make_product("Healthy", stocked=True)
    make_stock(b1, low, quantity=2, threshold=5)
    make_stock(b2, low, quantity=1, threshold=5)
    make_stock(b1, ok, quantity=50, threshold=5)
    r = admin.get(URL + "?low_stock=true").json()
    assert [p["name"] for p in r["results"]] == ["Low"] and r["results"][0]["stock_total"] == 3
    assert [p["name"] for p in admin.get(URL + "?low_stock=false").json()["results"]] == ["Healthy"]


def test_list_stock_figures_respect_branch_scope(login):
    b1, b2 = make_branch(), make_branch()
    beans = make_product("Beans", stocked=True)
    make_stock(b1, beans, quantity=2, threshold=5)
    make_stock(b2, beans, quantity=40, threshold=5)
    client = login(make_staff("ADMIN"))
    row = client.get(URL).json()["results"][0]
    assert (row["stock_total"], row["low_stock"]) == (42, True)
    # inventory managers may read the catalogue; their stock figures only cover their own branch
    client = login(make_staff("INVENTORY_MANAGER", branches=[b2]))
    row = client.get(URL).json()["results"][0]
    assert (row["stock_total"], row["low_stock"]) == (40, False)
    assert client.get(URL + "?low_stock=true").json()["count"] == 0


def test_list_query_count_constant(admin, django_assert_max_num_queries):
    cat = make_category()
    for i in range(12):
        p = make_product(f"P{i}", category=cat)
        p.tags.add(Tag.objects.get_or_create(name="t", slug="t")[0])
    with django_assert_max_num_queries(10):
        assert admin.get(URL + "?page_size=100").json()["count"] == 12


# ── delete vs archive ───────────────────────────────────────────────────────────────────────────────────────────────


def test_delete_blocked_when_product_has_orders(admin):
    product = make_product()
    make_order(make_branch(), [(product, 2)])
    r = admin.delete(f"{URL}{product.id}/")
    assert r.status_code == 409
    body = r.json()["error"]
    assert body["code"] == "has_orders" and "Archive" in body["message"]
    assert Product.objects.filter(pk=product.pk).exists()


def test_delete_unused_product_removes_it_and_audits(admin):
    product = make_product()
    ProductImage.objects.create(product=product, image="products/gallery/x.webp")
    r = admin.delete(f"{URL}{product.id}/")
    assert r.status_code == 204
    assert not Product.objects.filter(pk=product.pk).exists()
    log = AuditLog.objects.get(action="product.delete")
    assert log.resource_id == str(product.pk) and log.changes["old"]["sku"] == product.sku


def test_archive_and_unarchive(admin, api):
    product = make_product()
    make_order(make_branch(), [(product, 1)])
    r = admin.post(f"{URL}{product.id}/archive/")
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert api.get(f"/api/v1/products/{product.slug}/").status_code == 404
    assert AuditLog.objects.filter(action="product.archive").count() == 1
    admin.post(f"{URL}{product.id}/archive/")  # idempotent, no second audit row
    assert AuditLog.objects.filter(action="product.archive").count() == 1
    r = admin.post(f"{URL}{product.id}/unarchive/")
    assert r.json()["is_active"] is True
    assert api.get(f"/api/v1/products/{product.slug}/").status_code == 200


# ── images ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_image_upload_is_converted_to_webp_and_resized(admin, api):
    product = make_product()
    r = admin.post(f"{URL}{product.id}/image/", {"image": image_file(size=(3000, 2000))}, format="multipart")
    assert r.status_code == 200, r.content
    url = r.json()["image"]
    assert url.startswith("/media/products/") and url.endswith(".webp")
    product.refresh_from_db()
    with Image.open(product.image.path) as img:
        assert img.format == "WEBP" and max(img.size) == 1600 and img.size == (1600, 1067)
    assert api.get(f"/api/v1/products/{product.slug}/").json()["image"] == url
    assert AuditLog.objects.filter(action="product.image").exists()


def test_image_replacement_deletes_old_file(admin):
    product = make_product()
    admin.post(f"{URL}{product.id}/image/", {"image": image_file()}, format="multipart")
    product.refresh_from_db()
    old = product.image.path
    admin.post(f"{URL}{product.id}/image/", {"image": image_file(color=(0, 0, 0))}, format="multipart")
    product.refresh_from_db()
    import os

    assert product.image.path != old and not os.path.exists(old) and os.path.exists(product.image.path)


def test_jpeg_exif_is_stripped_and_png_alpha_kept(admin):
    product = make_product()
    admin.post(f"{URL}{product.id}/image/", {"image": image_file("a.jpg", "JPEG", exif=True)}, format="multipart")
    product.refresh_from_db()
    with Image.open(product.image.path) as img:
        assert not img.getexif()
    admin.post(
        f"{URL}{product.id}/image/",
        {"image": image_file("a.png", "PNG", mode="RGBA", color=(1, 2, 3, 128))},
        format="multipart",
    )
    product.refresh_from_db()
    with Image.open(product.image.path) as img:
        assert img.mode == "RGBA"


def test_image_validation_rejects_bad_uploads(admin, settings):
    from django.core.files.uploadedfile import SimpleUploadedFile

    product = make_product()
    cases = {
        "not an image": SimpleUploadedFile("evil.png", b"<?php system($_GET['c']); ?>", content_type="image/png"),
        "html as jpg": SimpleUploadedFile(
            "page.jpg", b"<html><script>alert(1)</script></html>", content_type="image/jpeg"
        ),
        "gif": image_file("anim.gif", "GIF"),
        "truncated": SimpleUploadedFile("cut.png", image_file().read()[:60], content_type="image/png"),
        "svg": SimpleUploadedFile(
            "x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", content_type="image/svg+xml"
        ),
        "empty": SimpleUploadedFile("empty.png", b"", content_type="image/png"),
    }
    for label, upload in cases.items():
        r = admin.post(f"{URL}{product.id}/image/", {"image": upload}, format="multipart")
        assert r.status_code == 400, label
        err = r.json()["error"]
        assert "image" in err["fields"], label
    product.refresh_from_db()
    assert not product.image


def test_image_missing_field_and_oversize(admin, settings):
    product = make_product()
    r = admin.post(f"{URL}{product.id}/image/", {}, format="multipart")
    assert r.status_code == 400 and r.json()["error"]["code"] == "image_required"
    settings.MAX_IMAGE_UPLOAD_BYTES = 1000
    r = admin.post(f"{URL}{product.id}/image/", {"image": image_file(size=(400, 400))}, format="multipart")
    assert r.status_code == 400 and r.json()["error"]["code"] == "image_too_large"


def test_spoofed_extension_but_real_image_is_accepted_as_webp(admin):
    product = make_product()
    r = admin.post(f"{URL}{product.id}/image/", {"image": image_file("photo.exe", "PNG")}, format="multipart")
    assert r.status_code == 200 and r.json()["image"].endswith(".webp")


def test_decompression_bomb_rejected(admin, monkeypatch):
    monkeypatch.setattr("apps.catalog.images.MAX_PIXELS", 100)
    product = make_product()
    r = admin.post(f"{URL}{product.id}/image/", {"image": image_file(size=(50, 50))}, format="multipart")
    assert r.status_code == 400 and r.json()["error"]["code"] == "image_too_large"


def test_remove_image(admin):
    product = make_product()
    admin.post(f"{URL}{product.id}/image/", {"image": image_file()}, format="multipart")
    r = admin.delete(f"{URL}{product.id}/image/")
    assert r.status_code == 200 and r.json() == {"image": None}
    product.refresh_from_db()
    assert not product.image


def test_gallery_add_patch_reorder_delete(admin, api):
    product = make_product()
    ids = []
    for alt in ("one", "two", "three"):
        r = admin.post(f"{URL}{product.id}/gallery/", {"image": image_file(), "alt_text": alt}, format="multipart")
        assert r.status_code == 201, r.content
        ids.append(r.json()["id"])
    assert [g["alt_text"] for g in admin.get(f"{URL}{product.id}/").json()["gallery"]] == ["one", "two", "three"]
    assert (
        admin.patch(f"{URL}{product.id}/gallery/{ids[0]}/", {"alt_text": "uno"}, format="json").json()["alt_text"]
        == "uno"
    )
    r = admin.post(f"{URL}{product.id}/gallery/reorder/", {"ids": [ids[2], ids[0], ids[1]]}, format="json")
    assert [g["id"] for g in r.json()] == [ids[2], ids[0], ids[1]]
    assert [g["url"] for g in api.get(f"/api/v1/products/{product.slug}/").json()["gallery"]][0].endswith(".webp")
    assert (
        admin.post(f"{URL}{product.id}/gallery/reorder/", {"ids": [ids[0], 999999]}, format="json").status_code == 400
    )
    assert admin.delete(f"{URL}{product.id}/gallery/{ids[1]}/").status_code == 204
    assert ProductImage.objects.filter(product=product).count() == 2
    other = make_product()
    assert admin.delete(f"{URL}{other.id}/gallery/{ids[0]}/").status_code == 404  # not that product's image


def test_gallery_limit_and_validation(admin):
    product = make_product()
    for _ in range(10):
        ProductImage.objects.create(product=product, image="products/gallery/x.webp")
    r = admin.post(f"{URL}{product.id}/gallery/", {"image": image_file()}, format="multipart")
    assert r.status_code == 409 and r.json()["error"]["code"] == "gallery_full"
    fresh = make_product()
    bad = admin.post(f"{URL}{fresh.id}/gallery/", {"image": image_file("x.gif", "GIF")}, format="multipart")
    assert bad.status_code == 400


# ── cache invalidation ──────────────────────────────────────────────────────────────────────────────────────────────


def test_price_change_visible_immediately_on_storefront(admin, api):
    product = make_product(price="4.00")
    assert api.get(f"/api/v1/products/{product.slug}/").json()["base_price"] == "4.00"
    assert api.get("/api/v1/products/").json()["results"][0]["base_price"] == "4.00"  # both now cached
    admin.patch(f"{URL}{product.id}/", {"base_price": "4.50"}, format="json")
    assert api.get(f"/api/v1/products/{product.slug}/").json()["base_price"] == "4.50"
    assert api.get("/api/v1/products/").json()["results"][0]["base_price"] == "4.50"


def test_archive_toggle_category_and_collection_changes_bust_cache(admin, api):
    category = make_category("Espresso")
    product = make_product(category=category)
    col = Collection.objects.create(name="Picks", slug="picks")
    CollectionItem.objects.create(collection=col, product=product)
    api.get("/api/v1/categories/"), api.get("/api/v1/collections/picks/"), api.get("/api/v1/products/")
    assert api.get("/api/v1/categories/").json()[0]["product_count"] == 1
    admin.post(f"{URL}{product.id}/archive/")
    assert api.get("/api/v1/categories/").json()[0]["product_count"] == 0
    assert api.get("/api/v1/collections/picks/").json()["products"] == []
    assert api.get("/api/v1/products/").json()["count"] == 0
    admin.patch(f"/api/v1/admin/categories/{category.id}/", {"is_active": False}, format="json")
    admin.post(f"{URL}{product.id}/unarchive/")
    assert api.get("/api/v1/products/").json()["count"] == 0  # category hidden
    assert api.get("/api/v1/categories/").json() == []


def test_cache_cleared_fixture_isolated():
    assert cache.get("nothing") is None
    assert Category.objects.count() == 0
