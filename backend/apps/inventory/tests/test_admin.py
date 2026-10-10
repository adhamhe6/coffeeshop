from decimal import Decimal

import pytest

from apps.accounts.permissions import ROLE_CAPABILITIES
from apps.core.models import AuditLog
from apps.inventory import services
from apps.inventory.models import BranchProduct, InventoryMovement, StockItem
from tests.factories import make_branch, make_category, make_product, make_staff, make_stock, make_user

pytestmark = pytest.mark.django_db

BASE = "/api/v1/admin/inventory/"
STOCK, ADJUST, MOVES, AVAIL, SUMMARY = (
    BASE + p for p in ("stock/", "adjust/", "movements/", "availability/", "summary/")
)
ROLES = list(ROLE_CAPABILITIES)


@pytest.fixture
def admin(login):
    return login(make_staff("ADMIN"))


def adjust_payload(branch, product, **kw):
    base = {"branch": branch.id, "product": product.id, "delta": 5, "movement_type": "RECEIPT"}
    base.update(kw)
    return base


# ── capabilities & scope ────────────────────────────────────────────────────────────────────────────────────────────


def test_unauthenticated_and_customers_blocked(api, login):
    for url in (STOCK, MOVES, AVAIL, SUMMARY):
        assert api.get(url).status_code == 401
    assert api.post(ADJUST, {}).status_code == 401
    login(make_user())
    for url in (STOCK, MOVES, AVAIL, SUMMARY):
        assert api.get(url).status_code == 403
    assert api.post(ADJUST, {}).status_code == 403


@pytest.mark.parametrize("role", ROLES)
def test_capability_matrix_inventory(login, role):
    branch = make_branch()
    beans = make_product(stocked=True)
    latte = make_product()
    item = make_stock(branch, beans, 10)
    client = login(make_staff(role, branches=[branch]))
    caps = ROLE_CAPABILITIES[role]
    view, manage = "inventory.view" in caps, "inventory.manage" in caps
    assert client.get(STOCK).status_code == (200 if view else 403)
    assert client.get(f"{STOCK}{item.id}/").status_code == (200 if view else 403)
    assert client.get(MOVES).status_code == (200 if view else 403)
    assert client.get(SUMMARY).status_code == (200 if view else 403)
    assert client.get(f"{AVAIL}?branch={branch.id}").status_code == (200 if view else 403)
    assert client.patch(f"{STOCK}{item.id}/", {"low_stock_threshold": 3}, format="json").status_code == (
        200 if manage else 403
    )
    assert client.post(ADJUST, adjust_payload(branch, beans), format="json").status_code == (201 if manage else 403)
    r = client.patch(AVAIL, {"branch": branch.id, "product": latte.id, "is_available": False}, format="json")
    assert r.status_code == (200 if manage else 403)


def test_manager_of_branch_a_cannot_see_or_touch_branch_b(login):
    a, b = make_branch(name="A"), make_branch(name="B")
    beans, latte = make_product(stocked=True), make_product()
    stock_a, stock_b = make_stock(a, beans, 10), make_stock(b, beans, 20)
    services.adjust_stock(b, beans, delta=1, movement_type="RECEIPT", actor=None)
    manager = login(make_staff("BRANCH_MANAGER", branches=[a]))
    rows = manager.get(STOCK).json()["results"]
    assert [r["id"] for r in rows] == [stock_a.id]
    assert manager.get(f"{STOCK}?branch={b.id}").json()["count"] == 0
    assert manager.get(f"{STOCK}{stock_b.id}/").status_code == 404
    assert manager.patch(f"{STOCK}{stock_b.id}/", {"low_stock_threshold": 1}, format="json").status_code == 404
    assert manager.post(ADJUST, adjust_payload(b, beans), format="json").status_code == 404
    assert manager.get(MOVES).json()["count"] == 0
    assert manager.get(f"{AVAIL}?branch={b.id}").status_code == 404
    assert (
        manager.patch(AVAIL, {"branch": b.id, "product": latte.id, "is_available": False}, format="json").status_code
        == 404
    )
    assert manager.get(f"{SUMMARY}?branch={b.id}").status_code == 404
    assert summary_total(manager) == 1
    stock_b.refresh_from_db()
    assert stock_b.quantity == 21 and stock_b.low_stock_threshold == 2
    assert not BranchProduct.objects.exists()


def summary_total(client):
    return client.get(SUMMARY).json()["tracked_items"]


# ── stock list ──────────────────────────────────────────────────────────────────────────────────────────────────────


def test_stock_list_payload_filters_and_value(admin):
    b1, b2 = make_branch(name="Alpha"), make_branch(name="Beta")
    cat = make_category()
    ethiopia = make_product("Ethiopia", category=cat, stocked=True)
    mug = make_product("Mug", category=cat, stocked=True)
    s1 = make_stock(b1, ethiopia, 3, threshold=5)
    s2 = make_stock(b1, mug, 50, threshold=5)
    s3 = make_stock(b2, ethiopia, 0, threshold=2)
    StockItem.objects.filter(pk=s1.pk).update(unit_cost=Decimal("7.50"))
    r = admin.get(STOCK).json()
    assert r["count"] == 3
    first = next(x for x in r["results"] if x["id"] == s1.id)
    assert (
        first["quantity"] == 3
        and first["is_low"] is True
        and first["unit_cost"] == "7.50"
        and first["stock_value"] == "22.50"
    )
    assert first["branch"]["name"] == "Alpha" and first["product"]["sku"] == ethiopia.sku
    assert next(x for x in r["results"] if x["id"] == s2.id)["stock_value"] is None

    def ids(query):
        return {x["id"] for x in admin.get(STOCK + query).json()["results"]}

    assert ids(f"?branch={b2.id}") == {s3.id}
    assert ids(f"?product={mug.id}") == {s2.id}
    assert ids("?low=true") == {s1.id, s3.id}
    assert ids("?low=false") == {s2.id}
    assert ids("?out_of_stock=true") == {s3.id}
    assert ids("?q=ethio") == {s1.id, s3.id}
    assert ids(f"?q={mug.sku}") == {s2.id}
    assert [x["quantity"] for x in admin.get(STOCK + "?ordering=-quantity").json()["results"]] == [50, 3, 0]
    assert admin.get(STOCK + "?branch=abc").status_code == 400


def test_stock_list_query_count_constant(admin, django_assert_max_num_queries):
    branch = make_branch()
    for i in range(15):
        make_stock(branch, make_product(f"P{i}", stocked=True), i)
    with django_assert_max_num_queries(6):  # session, user, staff profile, count, rows (+ scope)
        assert admin.get(STOCK + "?page_size=100").json()["count"] == 15


def test_patch_stock_threshold_and_cost_only(admin):
    branch = make_branch()
    item = make_stock(branch, make_product(stocked=True), 10)
    r = admin.patch(f"{STOCK}{item.id}/", {"low_stock_threshold": 12, "unit_cost": "3.20"}, format="json")
    assert r.status_code == 200 and r.json()["is_low"] is True and r.json()["stock_value"] == "32.00"
    log = AuditLog.objects.get(action="inventory.stock_update")
    assert log.changes["low_stock_threshold"] == {"old": 2, "new": 12}
    assert admin.patch(f"{STOCK}{item.id}/", {"quantity": 999}, format="json").status_code == 400
    assert admin.patch(f"{STOCK}{item.id}/", {"unit_cost": "-1"}, format="json").status_code == 400
    assert admin.patch(f"{STOCK}{item.id}/", {"low_stock_threshold": -1}, format="json").status_code == 400
    assert admin.put(f"{STOCK}{item.id}/", {}, format="json").status_code == 405
    assert admin.delete(f"{STOCK}{item.id}/").status_code == 405
    item.refresh_from_db()
    assert item.quantity == 10


# ── adjust ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_adjust_receipt_creates_item_and_returns_movement(admin):
    branch, beans = make_branch(), make_product(stocked=True)
    r = admin.post(ADJUST, adjust_payload(branch, beans, delta=24, reference="PO-77"), format="json")
    assert r.status_code == 201, r.content
    d = r.json()
    assert d["stock_item"]["quantity"] == 24 and d["stock_item"]["branch"]["id"] == branch.id
    assert d["movement"]["movement_type"] == "RECEIPT" and d["movement"]["quantity_after"] == 24
    assert d["movement"]["reference"] == "PO-77" and d["movement"]["actor"]["email"]
    assert AuditLog.objects.filter(action="inventory.adjust").count() == 1


def test_adjust_set_to_and_waste(admin):
    branch, beans = make_branch(), make_product(stocked=True)
    make_stock(branch, beans, 10)
    r = admin.post(
        ADJUST,
        adjust_payload(branch, beans, delta=None, set_to=4, movement_type="ADJUSTMENT", reason="Recount"),
        format="json",
    )
    assert r.status_code == 400  # delta=None counted as provided together with set_to
    payload = {
        "branch": branch.id,
        "product": beans.id,
        "set_to": 4,
        "movement_type": "ADJUSTMENT",
        "reason": "Recount",
    }
    r = admin.post(ADJUST, payload, format="json")
    assert r.status_code == 201 and r.json()["movement"]["quantity_delta"] == -6
    r = admin.post(
        ADJUST, adjust_payload(branch, beans, delta=-1, movement_type="WASTE", reason="Dropped"), format="json"
    )
    assert r.status_code == 201 and r.json()["stock_item"]["quantity"] == 3


@pytest.mark.parametrize(
    ("override", "status", "code_or_field"),
    [
        ({"movement_type": "ADJUSTMENT", "delta": 1}, 400, "reason"),
        ({"movement_type": "WASTE", "delta": -1}, 400, "reason"),
        ({"movement_type": "SALE", "delta": -1}, 400, "movement_type"),
        ({"movement_type": "RETURN", "delta": 1}, 400, "movement_type"),
        ({"delta": None, "set_to": None}, 400, "delta"),
        ({"set_to": 3}, 400, "delta"),
        ({"delta": 0}, 400, "no_change"),
        ({"delta": -50, "movement_type": "ADJUSTMENT", "reason": "x"}, 409, "insufficient_stock"),
        ({"delta": -1}, 400, "invalid_adjustment"),  # RECEIPT must add stock
        ({"delta": "x"}, 400, "delta"),
        ({"delta": 10**9}, 400, "delta"),
        ({"set_to": -1, "delta": None}, 400, "set_to"),
    ],
)
def test_adjust_rejections(admin, override, status, code_or_field):
    branch, beans = make_branch(), make_product(stocked=True)
    make_stock(branch, beans, 5)
    data = adjust_payload(branch, beans)
    for k, v in override.items():
        if v is None:
            data.pop(k, None)
        else:
            data[k] = v
    r = admin.post(ADJUST, data, format="json")
    assert r.status_code == status, r.content
    err = r.json()["error"]
    assert err["code"] == code_or_field or code_or_field in err.get("fields", {})
    assert StockItem.objects.get().quantity == 5
    assert not InventoryMovement.objects.exists()
    assert not AuditLog.objects.filter(action="inventory.adjust").exists()


def test_adjust_refuses_prepared_product_and_unknown_ids(admin):
    branch = make_branch()
    r = admin.post(ADJUST, adjust_payload(branch, make_product()), format="json")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_stock_managed"
    assert (
        admin.post(
            ADJUST, {**adjust_payload(branch, make_product(stocked=True)), "product": 999999}, format="json"
        ).status_code
        == 404
    )
    assert (
        admin.post(
            ADJUST, {**adjust_payload(branch, make_product(stocked=True)), "branch": 999999}, format="json"
        ).status_code
        == 404
    )
    assert not StockItem.objects.exists()


# ── movements ───────────────────────────────────────────────────────────────────────────────────────────────────────


def test_movements_filters_and_pagination(admin):
    b1, b2 = make_branch(), make_branch()
    beans, mug = make_product(stocked=True), make_product(stocked=True)
    actor = make_staff("INVENTORY_MANAGER", branches=[b1, b2])
    services.adjust_stock(b1, beans, delta=10, movement_type="RECEIPT", actor=actor, reference="PO-1")
    services.adjust_stock(b1, beans, delta=-2, movement_type="WASTE", reason="Spill", actor=None)
    services.adjust_stock(b2, mug, delta=7, movement_type="INITIAL", actor=None)
    all_rows = admin.get(MOVES).json()
    assert all_rows["count"] == 3
    assert all_rows["results"][0]["movement_type"] == "INITIAL"  # newest first
    row = next(r for r in all_rows["results"] if r["reference"] == "PO-1")
    assert row["actor"]["email"] == actor.email and row["branch"]["id"] == b1.id and row["product"]["sku"] == beans.sku

    def count(query):
        return admin.get(MOVES + query).json()["count"]

    assert count(f"?branch={b2.id}") == 1
    assert count(f"?product={beans.id}") == 2
    assert count("?type=WASTE") == 1
    assert count(f"?actor={actor.id}") == 1
    assert count("?reference=po-") == 1
    assert count("?date_from=2999-01-01") == 0
    assert count("?date_to=2000-01-01") == 0
    assert count("?date_from=2000-01-01&date_to=2999-01-01") == 3
    assert admin.get(MOVES + "?type=BOGUS").status_code == 400
    assert admin.get(MOVES + "?page_size=2").json()["next"]


def test_movements_query_count_constant(admin, django_assert_max_num_queries):
    branch = make_branch()
    for i in range(12):
        services.adjust_stock(branch, make_product(f"P{i}", stocked=True), delta=1, movement_type="RECEIPT", actor=None)
    with django_assert_max_num_queries(6):
        assert admin.get(MOVES + "?page_size=100").json()["count"] == 12


# ── availability ────────────────────────────────────────────────────────────────────────────────────────────────────


def test_availability_list_requires_branch_and_lists_prepared_only(admin):
    branch = make_branch()
    cat = make_category("Espresso")
    latte, mocha = make_product("Latte", category=cat), make_product("Mocha", category=cat, sort_order=1)
    make_product("Beans", category=cat, stocked=True)
    make_product("Archived", category=cat, is_active=False)
    BranchProduct.objects.create(branch=branch, product=mocha, is_available=False)
    assert admin.get(AVAIL).status_code == 400
    assert admin.get(AVAIL + "?branch=x").status_code == 400
    r = admin.get(f"{AVAIL}?branch={branch.id}").json()
    assert [(x["product"]["name"], x["is_available"]) for x in r["results"]] == [("Latte", True), ("Mocha", False)]
    assert r["results"][0]["category_name"] == "Espresso" and r["results"][0]["is_sold_out"] is False
    assert [
        x["product"]["name"] for x in admin.get(f"{AVAIL}?branch={branch.id}&available=false").json()["results"]
    ] == ["Mocha"]
    assert [
        x["product"]["name"] for x in admin.get(f"{AVAIL}?branch={branch.id}&available=true").json()["results"]
    ] == ["Latte"]
    assert [x["product"]["name"] for x in admin.get(f"{AVAIL}?branch={branch.id}&q=moc").json()["results"]] == ["Mocha"]
    assert latte.id


def test_availability_toggle_reflected_on_storefront_and_audited(admin, api):
    branch = make_branch(slug="main")
    latte = make_product("Latte")
    url = f"/api/v1/products/{latte.slug}/?branch=main"
    assert api.get(url).json()["is_available"] is True
    r = admin.patch(AVAIL, {"branch": branch.id, "product": latte.id, "is_available": False}, format="json")
    assert r.status_code == 200 and r.json()["is_available"] is False and r.json()["updated_at"]
    d = api.get(url).json()
    assert (d["is_available"], d["unavailable_reason"]) == (False, "branch_unavailable")
    admin.patch(AVAIL, {"branch": branch.id, "product": latte.id, "is_available": False}, format="json")  # no-op
    assert AuditLog.objects.filter(action="inventory.availability").count() == 1
    assert (
        admin.patch(AVAIL, {"branch": branch.id, "product": latte.id, "is_available": True}, format="json").json()[
            "is_available"
        ]
        is True
    )
    assert api.get(url).json()["is_available"] is True
    assert AuditLog.objects.filter(action="inventory.availability").count() == 2


def test_availability_rejects_stocked_unknown_and_bad_payload(admin):
    branch = make_branch()
    beans = make_product(stocked=True)
    r = admin.patch(AVAIL, {"branch": branch.id, "product": beans.id, "is_available": False}, format="json")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_prepared_product"
    assert (
        admin.patch(AVAIL, {"branch": branch.id, "product": 99999, "is_available": False}, format="json").status_code
        == 404
    )
    assert admin.patch(AVAIL, {"branch": branch.id, "product": beans.id}, format="json").status_code == 400
    assert not BranchProduct.objects.exists()


def test_availability_enabling_a_never_toggled_product_creates_no_row(admin):
    branch, latte = make_branch(), make_product()
    admin.patch(AVAIL, {"branch": branch.id, "product": latte.id, "is_available": True}, format="json")
    assert not BranchProduct.objects.exists()


# ── summary ─────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_summary_aggregates(admin):
    b1, b2 = make_branch(name="Alpha"), make_branch(name="Beta")
    a, b, c, d = (make_product(n, stocked=True) for n in ("A", "B", "C", "D"))
    s_a = make_stock(b1, a, 10, threshold=5)  # fine, valued
    s_b = make_stock(b1, b, 3, threshold=5)  # low, valued
    make_stock(b2, c, 0, threshold=5)  # out
    make_stock(b2, d, 4, threshold=5)  # low, no cost
    StockItem.objects.filter(pk=s_a.pk).update(unit_cost=Decimal("2.50"))
    StockItem.objects.filter(pk=s_b.pk).update(unit_cost=Decimal("10.00"))
    archived = make_product("Old", stocked=True, is_active=False)
    make_stock(b1, archived, 100, threshold=5)  # archived products are ignored
    latte = make_product("Latte")
    BranchProduct.objects.create(branch=b1, product=latte, is_available=False)
    sold = make_product("Sold", is_sold_out=True)
    r = admin.get(SUMMARY)
    assert r.status_code == 200
    d_ = r.json()
    assert d_["tracked_items"] == 4 and d_["low_stock_count"] == 3 and d_["out_of_stock_count"] == 1
    assert d_["valuation"] == "55.00" and d_["unvalued_items"] == 1
    reasons = sorted((u["reason"], u["product"]["name"], (u["branch"] or {}).get("name")) for u in d_["unavailable"])
    assert reasons == [
        ("branch_unavailable", "Latte", "Alpha"),
        ("out_of_stock", "C", "Beta"),
        ("sold_out", "Sold", None),
    ]
    only_b1 = admin.get(f"{SUMMARY}?branch={b1.id}").json()
    assert only_b1["tracked_items"] == 2 and only_b1["out_of_stock_count"] == 0 and only_b1["valuation"] == "55.00"
    assert [u["reason"] for u in only_b1["unavailable"]] == ["branch_unavailable"]
    assert sold.id


def test_summary_empty_and_scoped(login):
    a, b = make_branch(), make_branch()
    beans = make_product(stocked=True)
    make_stock(b, beans, 0)
    manager = login(make_staff("BRANCH_MANAGER", branches=[a]))
    d = manager.get(SUMMARY).json()
    assert d == {
        "tracked_items": 0,
        "low_stock_count": 0,
        "out_of_stock_count": 0,
        "valuation": "0.00",
        "unvalued_items": 0,
        "unavailable": [],
    }
