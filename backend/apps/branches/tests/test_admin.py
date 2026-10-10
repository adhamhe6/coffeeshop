from datetime import time

import pytest
from freezegun import freeze_time

from apps.accounts.permissions import ROLE_CAPABILITIES
from apps.branches.models import Branch, BranchClosure, BranchDeliveryZone, BranchHours, DeliveryZone
from apps.core.models import AuditLog
from apps.inventory.tests.helpers import make_order
from tests.factories import make_address, make_branch, make_product, make_staff, make_user, make_zone

from .helpers import set_hours

pytestmark = pytest.mark.django_db

BR = "/api/v1/admin/branches/"
ZONES = "/api/v1/admin/delivery-zones/"
ROLES = list(ROLE_CAPABILITIES)


def branch_payload(**kw):
    base = {
        "code": "NEW",
        "name": "New Branch",
        "address_line": "9 Main St",
        "city": "Springfield",
        "timezone": "America/Chicago",
        "pickup_enabled": True,
        "delivery_enabled": False,
        "prep_minutes": 12,
    }
    base.update(kw)
    return base


@pytest.fixture
def admin(login):
    return login(make_staff("ADMIN"))


# ── capability matrix and scoping ───────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", ROLES)
def test_capability_matrix_branches(login, role):
    own = make_branch()
    staff = make_staff(role, branches=[own])
    client = login(staff)
    caps = ROLE_CAPABILITIES[role]
    view, manage = "branches.view" in caps, "branches.manage" in caps
    is_global = role in ("SUPER_ADMIN", "ADMIN")
    assert client.get(BR).status_code == (200 if view else 403)
    assert client.get(f"{BR}{own.id}/").status_code == (200 if view else 403)
    assert client.get(f"{BR}{own.id}/hours/").status_code == (200 if view else 403)
    assert client.get(ZONES).status_code == (200 if view else 403)
    assert client.patch(f"{BR}{own.id}/", {"prep_minutes": 20}, format="json").status_code == (200 if manage else 403)
    assert client.put(f"{BR}{own.id}/hours/", {"hours": []}, format="json").status_code == (200 if manage else 403)
    assert client.post(
        f"{BR}{own.id}/closures/", {"start_date": "2030-01-01", "end_date": "2030-01-01"}, format="json"
    ).status_code == (201 if manage else 403)
    r = client.post(BR, branch_payload(code=f"X{role[:3]}"), format="json")
    assert r.status_code == (201 if (manage and is_global) else 403), (role, r.content)
    r = client.post(ZONES, {"name": f"Zone {role}"}, format="json")
    assert r.status_code == (201 if (manage and is_global) else 403)


def test_anonymous_and_customer_blocked(api, login):
    assert api.get(BR).status_code == 401
    login(make_user())
    assert api.get(BR).status_code == 403
    assert api.get(ZONES).status_code == 403


def test_manager_sees_and_touches_only_own_branch(login):
    a, b = make_branch(name="A"), make_branch(name="B")
    manager = login(make_staff("BRANCH_MANAGER", branches=[a]))
    assert [x["name"] for x in manager.get(BR).json()["results"]] == ["A"]
    assert manager.get(f"{BR}{a.id}/").status_code == 200
    zone = make_zone("Z")
    link = BranchDeliveryZone.objects.create(branch=b, zone=zone)
    closure = BranchClosure.objects.create(branch=b, start_date="2030-01-01", end_date="2030-01-02")
    for method, url, body in (
        ("get", f"{BR}{b.id}/", None),
        ("patch", f"{BR}{b.id}/", {"name": "Hijack"}),
        ("delete", f"{BR}{b.id}/", None),
        ("get", f"{BR}{b.id}/hours/", None),
        ("put", f"{BR}{b.id}/hours/", {"hours": []}),
        ("get", f"{BR}{b.id}/closures/", None),
        ("post", f"{BR}{b.id}/closures/", {"start_date": "2030-01-01", "end_date": "2030-01-01"}),
        ("patch", f"{BR}{b.id}/closures/{closure.id}/", {"reason": "x"}),
        ("delete", f"{BR}{b.id}/closures/{closure.id}/", None),
        ("get", f"{BR}{b.id}/zones/", None),
        ("post", f"{BR}{b.id}/zones/", {"zone": zone.id}),
        ("patch", f"{BR}{b.id}/zones/{link.id}/", {"fee": "1.00"}),
        ("delete", f"{BR}{b.id}/zones/{link.id}/", None),
        ("get", f"{BR}{b.id}/staff/", None),
        ("post", f"{BR}{b.id}/image/", None),
    ):
        r = getattr(manager, method)(url, body, format="json") if body is not None else getattr(manager, method)(url)
        # deleting a branch needs global scope, so a manager is stopped by the permission (403) before any lookup
        assert r.status_code == (403 if (method, url) == ("delete", f"{BR}{b.id}/") else 404), (
            method,
            url,
            r.status_code,
        )
    b.refresh_from_db()
    assert b.name == "B" and closure.__class__.objects.filter(pk=closure.pk).exists()


def test_branch_ids_cannot_be_probed_through_closure_of_other_branch(login):
    a, b = make_branch(), make_branch()
    closure = BranchClosure.objects.create(branch=b, start_date="2030-01-01", end_date="2030-01-02")
    manager = login(make_staff("BRANCH_MANAGER", branches=[a]))
    # own branch id + foreign child id still 404
    assert manager.delete(f"{BR}{a.id}/closures/{closure.id}/").status_code == 404
    assert BranchClosure.objects.filter(pk=closure.pk).exists()


def test_manager_without_branches_sees_nothing(login):
    make_branch()
    client = login(make_staff("BRANCH_MANAGER"))
    assert client.get(BR).json()["count"] == 0


# ── create / update / delete ────────────────────────────────────────────────────────────────────────────────────────


def test_admin_creates_branch(admin):
    r = admin.post(BR, branch_payload(code="dt", latitude="41.878100", longitude="-87.629800"), format="json")
    assert r.status_code == 201, r.content
    d = r.json()
    assert d["code"] == "DT" and d["slug"] == "new-branch" and d["is_active"] is True and d["is_open_now"] is False
    assert d["accepting_orders"] is True and d["latitude"] == "41.878100"
    log = AuditLog.objects.get(action="branch.create")
    assert log.changes["new"]["code"] == "DT"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("timezone", "Mars/Olympus"),
        ("latitude", "91"),
        ("longitude", "-181"),
        ("prep_minutes", 999),
        ("name", " "),
        ("email", "nope"),
        ("code", ""),
        ("code", "has space"),
    ],
)
def test_branch_validation(admin, field, value):
    r = admin.post(BR, branch_payload(**{field: value}), format="json")
    assert r.status_code == 400 and field in r.json()["error"]["fields"], r.content


def test_branch_uniqueness_errors_are_field_errors(admin):
    existing = make_branch(code="TAKEN", slug="taken")
    r = admin.post(BR, branch_payload(code="taken"), format="json")
    assert r.status_code == 400 and "code" in r.json()["error"]["fields"]
    r = admin.post(BR, branch_payload(code="OK1", slug=existing.slug), format="json")
    assert r.status_code == 400 and "slug" in r.json()["error"]["fields"]
    other = make_branch()
    assert admin.patch(f"{BR}{other.id}/", {"code": "TAKEN"}, format="json").status_code == 400


def test_admin_updates_everything_and_audits(admin):
    branch = make_branch(name="Old", delivery=False)
    r = admin.patch(
        f"{BR}{branch.id}/",
        {
            "name": "Renamed",
            "delivery_enabled": True,
            "accepting_orders": False,
            "is_active": False,
            "is_placeholder_address": True,
        },
        format="json",
    )
    assert r.status_code == 200
    branch.refresh_from_db()
    assert (branch.name, branch.delivery_enabled, branch.accepting_orders, branch.is_active) == (
        "Renamed",
        True,
        False,
        False,
    )
    log = AuditLog.objects.get(action="branch.update")
    assert log.changes["accepting_orders"] == {"old": True, "new": False}


def test_manager_can_change_operational_fields_of_own_branch_only(login):
    own = make_branch(name="Own", delivery=False)
    manager = login(make_staff("BRANCH_MANAGER", branches=[own]))
    r = manager.patch(
        f"{BR}{own.id}/",
        {
            "name": "Own Renamed",
            "accepting_orders": False,
            "pickup_enabled": False,
            "delivery_enabled": True,
            "prep_minutes": 25,
            "phone": "555",
        },
        format="json",
    )
    assert r.status_code == 200, r.content
    own.refresh_from_db()
    assert (own.accepting_orders, own.pickup_enabled, own.delivery_enabled, own.prep_minutes) == (
        False,
        False,
        True,
        25,
    )
    for field, value in (("is_active", False), ("code", "HACK"), ("slug", "hacked"), ("sort_order", 9)):
        r = manager.patch(f"{BR}{own.id}/", {field: value}, format="json")
        assert r.status_code == 403, field
        assert r.json()["error"]["code"] == "global_scope_required" and field in r.json()["error"]["fields"]
    own.refresh_from_db()
    assert own.is_active and own.slug != "hacked"
    # sending the unchanged value of a restricted field is fine
    assert (
        manager.patch(f"{BR}{own.id}/", {"is_active": True, "code": own.code.lower()}, format="json").status_code == 200
    )


def test_delete_branch_rules(admin, login):
    busy = make_branch()
    make_order(busy, [(make_product(), 1)])
    r = admin.delete(f"{BR}{busy.id}/")
    assert r.status_code == 409 and r.json()["error"]["code"] == "has_orders"
    idle = make_branch()
    assert admin.delete(f"{BR}{idle.id}/").status_code == 204
    assert not Branch.objects.filter(pk=idle.pk).exists()
    assert AuditLog.objects.filter(action="branch.delete").exists()
    mine = make_branch()
    manager = login(make_staff("BRANCH_MANAGER", branches=[mine]))
    r = manager.delete(f"{BR}{mine.id}/")
    assert r.status_code == 403 and Branch.objects.filter(pk=mine.pk).exists()


def test_branch_filters_and_options(admin, login):
    a, b = make_branch(name="Alpha"), make_branch(name="Beta", is_active=False)
    Branch.objects.filter(pk=a.pk).update(city="Rome")
    assert admin.get(BR + "?is_active=false").json()["count"] == 1
    assert admin.get(BR + "?search=rome").json()["results"][0]["name"] == "Alpha"
    opts = admin.get(BR + "options/")
    assert opts.status_code == 200 and {o["id"] for o in opts.json()} == {a.id, b.id}
    assert set(opts.json()[0]) == {"id", "code", "name", "slug", "is_active"}
    # every kind of staff may fetch their own branch options, customers may not
    order_mgr = login(make_staff("ORDER_MANAGER", branches=[a]))
    assert [o["id"] for o in order_mgr.get(BR + "options/").json()] == [a.id]
    login(make_user())
    assert order_mgr.get(BR + "options/").status_code == 403


def test_branch_staff_listing(admin):
    branch = make_branch()
    manager = make_staff("BRANCH_MANAGER", branches=[branch])
    make_staff("BRANCH_MANAGER", branches=[make_branch()])
    rows = admin.get(f"{BR}{branch.id}/staff/").json()
    assert [r["email"] for r in rows] == [manager.email] and rows[0]["role"] == "BRANCH_MANAGER"


def test_branch_image_upload(admin):
    from apps.catalog.tests.helpers import image_file

    branch = make_branch()
    r = admin.post(f"{BR}{branch.id}/image/", {"image": image_file()}, format="multipart")
    assert r.status_code == 200 and r.json()["image"].startswith("/media/branches/")
    assert (
        admin.post(f"{BR}{branch.id}/image/", {"image": image_file("x.gif", "GIF")}, format="multipart").status_code
        == 400
    )


# ── hours ───────────────────────────────────────────────────────────────────────────────────────────────────────────


def week(open_="08:00", close="18:00", **overrides):
    days = [{"weekday": d, "is_closed": False, "opens": open_, "closes": close} for d in range(7)]
    for d, v in overrides.items():
        days[int(d[1:])] = {"weekday": int(d[1:]), **v}
    return days


def test_put_hours_replaces_whole_week(admin):
    branch = make_branch()
    r = admin.put(f"{BR}{branch.id}/hours/", {"hours": week(d6={"is_closed": True})}, format="json")
    assert r.status_code == 200, r.content
    assert len(r.json()) == 7 and r.json()[6] == {"weekday": 6, "is_closed": True, "opens": None, "closes": None}
    assert r.json()[0] == {"weekday": 0, "is_closed": False, "opens": "08:00:00", "closes": "18:00:00"}
    assert BranchHours.objects.filter(branch=branch).count() == 7
    # a bare list is accepted too; omitted days become closed
    r = admin.put(f"{BR}{branch.id}/hours/", [{"weekday": 2, "opens": "09:00", "closes": "12:30"}], format="json")
    assert r.status_code == 200
    by_day = {h["weekday"]: h for h in admin.get(f"{BR}{branch.id}/hours/").json()}
    assert by_day[2]["closes"] == "12:30:00" and all(by_day[d]["is_closed"] for d in (0, 1, 3, 4, 5, 6))
    assert AuditLog.objects.filter(action="branch.hours").count() == 2


@pytest.mark.parametrize(
    "bad",
    [
        [{"weekday": 0, "opens": "18:00", "closes": "08:00"}],
        [{"weekday": 0, "opens": "08:00", "closes": "08:00"}],
        [{"weekday": 0}],
        [{"weekday": 0, "opens": "08:00"}],
        [{"weekday": 7, "opens": "08:00", "closes": "09:00"}],
        [{"weekday": 0, "opens": "08:00", "closes": "09:00"}, {"weekday": 0, "opens": "10:00", "closes": "11:00"}],
        [{"weekday": 0, "opens": "25:00", "closes": "26:00"}],
    ],
)
def test_put_hours_validation_keeps_old_hours(admin, bad):
    branch = make_branch()
    r = admin.put(f"{BR}{branch.id}/hours/", {"hours": bad}, format="json")
    assert r.status_code == 400
    assert BranchHours.objects.filter(branch=branch, closes=time(23, 59)).count() == 7


@freeze_time("2026-06-15 12:00:00")
def test_hours_change_affects_storefront_and_slots_immediately(admin, api):
    branch = make_branch(slug="main", open_all_week=False, prep_minutes=0)
    set_hours(branch, dict.fromkeys(range(7), (time(9), time(10))))
    assert api.get("/api/v1/branches/main/slots/").json()["asap_available"] is False
    admin.put(f"{BR}{branch.id}/hours/", {"hours": week("08:00", "20:00")}, format="json")
    d = api.get("/api/v1/branches/main/slots/").json()
    assert d["asap_available"] is True and d["slots"][0]["starts_at"] == "2026-06-15T12:00:00Z"


# ── closures ────────────────────────────────────────────────────────────────────────────────────────────────────────


def test_closures_crud(admin):
    branch = make_branch()
    url = f"{BR}{branch.id}/closures/"
    r = admin.post(url, {"start_date": "2026-12-24", "end_date": "2026-12-26", "reason": "Holidays"}, format="json")
    assert r.status_code == 201
    cid = r.json()["id"]
    assert admin.get(url).json()[0]["reason"] == "Holidays"
    assert admin.patch(f"{url}{cid}/", {"end_date": "2026-12-27"}, format="json").json()["end_date"] == "2026-12-27"
    assert admin.patch(f"{url}{cid}/", {"end_date": "2026-12-01"}, format="json").status_code == 400
    assert admin.post(url, {"start_date": "2026-12-26", "end_date": "2026-12-24"}, format="json").status_code == 400
    assert admin.post(url, {"start_date": "nope", "end_date": "2026-12-24"}, format="json").status_code == 400
    assert admin.delete(f"{url}{cid}/").status_code == 204
    assert admin.delete(f"{url}{cid}/").status_code == 404
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"branch.closure_add", "branch.closure_update", "branch.closure_remove"} <= actions


@freeze_time("2026-06-15 12:00:00")
def test_closure_blocks_ordering_on_storefront(admin, api):
    branch = make_branch(slug="main")
    assert api.get("/api/v1/branches/main/slots/").json()["asap_available"] is True
    admin.post(f"{BR}{branch.id}/closures/", {"start_date": "2026-06-15", "end_date": "2026-06-15"}, format="json")
    d = api.get("/api/v1/branches/main/slots/").json()
    assert d["asap_available"] is False and d["slots"] == []
    assert (
        api.get("/api/v1/branches/main/slots/?date=2026-06-16").json()["slots"][0]["starts_at"].startswith("2026-06-16")
    )


# ── zone links ──────────────────────────────────────────────────────────────────────────────────────────────────────


def test_zone_links_crud(admin, api):
    branch = make_branch(slug="main", delivery=True)
    zone = make_zone("Old Town")
    url = f"{BR}{branch.id}/zones/"
    assert api.get("/api/v1/branches/main/").json()["delivery_zones"] == []
    r = admin.post(
        url,
        {"zone": zone.id, "fee": "2.50", "min_order_total": "10.00", "free_delivery_over": "30.00", "eta_minutes": 25},
        format="json",
    )
    assert r.status_code == 201, r.content
    assert r.json()["zone_name"] == "Old Town" and r.json()["fee"] == "2.50"
    link_id = r.json()["id"]
    assert api.get("/api/v1/branches/main/").json()["delivery_zones"][0]["fee"] == "2.50"
    assert api.get("/api/v1/delivery-zones/").json()[0]["branch_slugs"] == ["main"]
    dup = admin.post(url, {"zone": zone.id}, format="json")
    assert dup.status_code == 400 and "zone" in dup.json()["error"]["fields"]
    assert admin.post(url, {"zone": 99999}, format="json").status_code == 400
    assert admin.post(url, {"zone": make_zone("Neg").id, "fee": "-1"}, format="json").status_code == 400
    r = admin.patch(f"{url}{link_id}/", {"fee": "4.00", "is_active": False, "free_delivery_over": None}, format="json")
    assert r.status_code == 200 and r.json()["fee"] == "4.00" and r.json()["free_delivery_over"] is None
    assert api.get("/api/v1/branches/main/").json()["delivery_zones"] == []
    assert admin.patch(f"{url}{link_id}/", {"zone": make_zone("Other").id}, format="json").status_code == 400
    assert admin.patch(f"{url}{link_id}/", {"eta_minutes": 0}, format="json").status_code == 400
    assert len(admin.get(url).json()) == 1
    assert admin.delete(f"{url}{link_id}/").status_code == 204
    assert api.get("/api/v1/delivery-zones/").json()[0]["branch_slugs"] == []
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"branch.zone_add", "branch.zone_update", "branch.zone_remove"} <= actions


def test_manager_can_manage_zone_links_of_own_branch(login):
    own = make_branch(delivery=True)
    zone = make_zone("Z")
    manager = login(make_staff("BRANCH_MANAGER", branches=[own]))
    r = manager.post(f"{BR}{own.id}/zones/", {"zone": zone.id, "fee": "1.00"}, format="json")
    assert r.status_code == 201
    assert manager.patch(f"{BR}{own.id}/zones/{r.json()['id']}/", {"fee": "2.00"}, format="json").status_code == 200


# ── delivery zones (global) ─────────────────────────────────────────────────────────────────────────────────────────


def test_delivery_zone_crud(admin):
    r = admin.post(ZONES, {"name": "Harbour"}, format="json")
    assert r.status_code == 201 and r.json()["slug"] == "harbour" and r.json()["branch_count"] == 0
    zid = r.json()["id"]
    assert admin.post(ZONES, {"name": "harbour"}, format="json").status_code == 400
    assert admin.patch(f"{ZONES}{zid}/", {"is_active": False}, format="json").json()["is_active"] is False
    assert admin.get(ZONES + "?is_active=false").json()["count"] == 1
    assert admin.delete(f"{ZONES}{zid}/").status_code == 204
    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"delivery_zone.create", "delivery_zone.update", "delivery_zone.delete"} <= actions


def test_delivery_zone_delete_refused_when_used(admin):
    branch = make_branch()
    linked = make_zone("Linked", branch)
    r = admin.delete(f"{ZONES}{linked.id}/")
    assert r.status_code == 409 and r.json()["error"]["code"] == "in_use"
    addressed = make_zone("Addressed")
    make_address(make_user(), zone=addressed)
    assert admin.delete(f"{ZONES}{addressed.id}/").status_code == 409
    assert DeliveryZone.objects.filter(pk=addressed.pk).exists()


def test_branch_manager_reads_but_cannot_write_zones(login):
    own = make_branch()
    zone = make_zone("Z")
    manager = login(make_staff("BRANCH_MANAGER", branches=[own]))
    assert manager.get(ZONES).status_code == 200
    for method, url, body in (
        ("post", ZONES, {"name": "New"}),
        ("patch", f"{ZONES}{zone.id}/", {"name": "X"}),
        ("delete", f"{ZONES}{zone.id}/", None),
    ):
        r = getattr(manager, method)(url, body, format="json") if body else getattr(manager, method)(url)
        assert r.status_code == 403, method
    zone.refresh_from_db()
    assert zone.name == "Z"


def test_zone_changes_bust_public_zone_cache(admin, api):
    zone = make_zone("Cached")
    assert [z["name"] for z in api.get("/api/v1/delivery-zones/").json()] == ["Cached"]
    admin.patch(f"{ZONES}{zone.id}/", {"name": "Renamed"}, format="json")
    assert [z["name"] for z in api.get("/api/v1/delivery-zones/").json()] == ["Renamed"]
    admin.patch(f"{ZONES}{zone.id}/", {"is_active": False}, format="json")
    assert api.get("/api/v1/delivery-zones/").json() == []
