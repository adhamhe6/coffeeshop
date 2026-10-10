import pytest
from rest_framework.test import APIClient

from apps.accounts.models import StaffProfile, User
from apps.accounts.permissions import ALL_CAPABILITIES, ROLE_CAPABILITIES
from apps.core.models import AuditLog
from apps.core.testing import client_for
from tests.factories import make_branch, make_staff, make_user

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/staff/"
ROLES = sorted(ROLE_CAPABILITIES)
PASSWORD = "Temp0rary-Passw0rd"


def create_body(**over):
    data = {
        "email": "New.Hire@Example.com",
        "first_name": "New",
        "last_name": "Hire",
        "password": PASSWORD,
        "role": "PRODUCT_MANAGER",
        "job_title": "Menu lead",
    }
    data.update(over)
    return data


@pytest.fixture
def sa():
    return make_staff("SUPER_ADMIN", email="root@example.com")


@pytest.fixture
def sa_client(sa):
    return client_for(sa)


class TestPermissions:
    @pytest.mark.parametrize("role", ROLES)
    def test_every_endpoint_requires_staff_manage(self, role):
        branch = make_branch()
        actor = make_staff(role, branches=[branch])
        target = make_staff("PRODUCT_MANAGER")
        client = client_for(actor)
        calls = [
            ("get", URL, None),
            ("get", f"{URL}{target.pk}/", None),
            ("get", f"{URL}roles/", None),
            ("post", URL, create_body(email="x@example.com")),
            ("patch", f"{URL}{target.pk}/", {"job_title": "x"}),
            ("post", f"{URL}{target.pk}/deactivate/", None),
            ("post", f"{URL}{target.pk}/activate/", None),
        ]
        allowed = "staff.manage" in ROLE_CAPABILITIES[role]
        for method, url, body in calls:
            res = getattr(client, method)(url, body, format="json")
            if allowed:
                assert res.status_code != 403, (method, url)
            else:
                assert res.status_code == 403, (method, url, role)
        if not allowed:
            assert not User.objects.filter(email="x@example.com").exists()
            target.refresh_from_db()
            assert target.is_active and target.staff_profile.job_title == ""

    def test_anonymous_and_customer(self):
        assert APIClient().get(URL).status_code == 401
        assert APIClient().post(URL, create_body(), format="json").status_code == 401
        assert client_for(make_user()).get(URL).status_code == 403


class TestListAndRoles:
    def test_list_has_only_staff_and_no_secrets(self, sa_client):
        make_user("customer@example.com")
        make_staff("ADMIN", email="admin@example.com")
        res = sa_client.get(URL)
        assert res.status_code == 200
        emails = {r["email"] for r in res.json()["results"]}
        assert emails == {"root@example.com", "admin@example.com"}
        text = res.content.decode()
        assert "password" not in text and "md5$" not in text

    def test_filters_and_search(self, sa_client):
        branch = make_branch()
        make_staff("BRANCH_MANAGER", branches=[branch], email="bm@example.com")
        inactive = make_staff("SUPPORT_AGENT", email="gone@example.com")
        inactive.is_active = False
        inactive.save()
        assert {r["email"] for r in sa_client.get(URL, {"role": "BRANCH_MANAGER"}).json()["results"]} == {
            "bm@example.com"
        }
        assert {r["email"] for r in sa_client.get(URL, {"is_active": "false"}).json()["results"]} == {
            "gone@example.com"
        }
        assert {r["email"] for r in sa_client.get(URL, {"search": "gone@"}).json()["results"]} == {"gone@example.com"}
        row = sa_client.get(URL, {"role": "BRANCH_MANAGER"}).json()["results"][0]
        assert row["branch_ids"] == [branch.pk] and row["branches"] == [{"id": branch.pk, "name": branch.name}]
        assert row["role_label"] == "Branch manager"

    def test_roles_matrix(self, sa_client):
        body = sa_client.get(f"{URL}roles/").json()
        assert body["capabilities"] == ALL_CAPABILITIES
        roles = {r["role"]: r for r in body["roles"]}
        assert set(roles) == set(ROLES)
        for role, row in roles.items():
            assert set(row["capabilities"]) == ROLE_CAPABILITIES[role]
        assert roles["ADMIN"]["is_global"] and roles["BRANCH_MANAGER"]["branch_required"]
        assert not roles["PRODUCT_MANAGER"]["branch_required"] and "staff.manage" not in roles["ADMIN"]["capabilities"]


class TestCreate:
    def test_success_and_can_sign_in(self, sa_client, sa):
        branch = make_branch()
        res = sa_client.post(URL, create_body(role="ORDER_MANAGER", branch_ids=[branch.pk]), format="json")
        assert res.status_code == 201
        body = res.json()
        assert body["email"] == "new.hire@example.com" and body["role"] == "ORDER_MANAGER"
        assert body["branch_ids"] == [branch.pk] and body["job_title"] == "Menu lead" and body["is_active"] is True
        assert "password" not in res.content.decode()
        user = User.objects.get(email="new.hire@example.com")
        assert user.is_staff and not user.is_superuser
        entry = AuditLog.objects.get(action="staff.create")
        assert entry.actor_id == sa.pk and entry.resource_id == str(user.pk)
        assert entry.changes["role"] == "ORDER_MANAGER" and PASSWORD not in str(entry.changes) + entry.summary
        login = APIClient().post(
            "/api/v1/auth/login/", {"email": "new.hire@example.com", "password": PASSWORD}, format="json"
        )
        assert login.status_code == 200
        staff = login.json()["staff"]
        assert staff["role"] == "ORDER_MANAGER" and staff["branch_ids"] == [branch.pk]

    def test_weak_temp_password(self, sa_client):
        res = sa_client.post(URL, create_body(password="password"), format="json")
        assert res.status_code == 400 and "password" in res.json()["error"]["fields"]
        assert not User.objects.filter(email="new.hire@example.com").exists()

    def test_duplicate_email_case_insensitive(self, sa_client):
        make_user("new.hire@example.com")
        res = sa_client.post(URL, create_body(), format="json")
        assert res.status_code == 400 and "email" in res.json()["error"]["fields"]

    def test_invalid_role(self, sa_client):
        res = sa_client.post(URL, create_body(role="GOD"), format="json")
        assert res.status_code == 400 and "role" in res.json()["error"]["fields"]

    @pytest.mark.parametrize("role", ["BRANCH_MANAGER", "ORDER_MANAGER", "INVENTORY_MANAGER"])
    def test_branch_scoped_roles_need_a_branch(self, sa_client, role):
        res = sa_client.post(URL, create_body(role=role), format="json")
        assert res.status_code == 400 and "branch_ids" in res.json()["error"]["fields"]
        assert (
            sa_client.post(URL, create_body(role=role, branch_ids=[make_branch().pk]), format="json").status_code == 201
        )

    @pytest.mark.parametrize("role", ["PRODUCT_MANAGER", "MARKETING_MANAGER", "SUPPORT_AGENT"])
    def test_branchless_roles_ok(self, sa_client, role):
        assert sa_client.post(URL, create_body(role=role), format="json").status_code == 201

    def test_unknown_branch_rejected(self, sa_client):
        res = sa_client.post(URL, create_body(role="BRANCH_MANAGER", branch_ids=[987654]), format="json")
        assert res.status_code == 400 and "branch_ids" in res.json()["error"]["fields"]

    def test_global_roles_are_never_branch_scoped(self, sa_client):
        branch = make_branch()
        res = sa_client.post(URL, create_body(role="ADMIN", branch_ids=[branch.pk]), format="json")
        assert res.status_code == 201 and res.json()["branch_ids"] == []
        me = client_for(User.objects.get(email="new.hire@example.com")).get("/api/v1/auth/me/").json()
        assert me["staff"]["branch_ids"] is None

    def test_creating_super_admin_sets_superuser_flag(self, sa_client):
        res = sa_client.post(URL, create_body(role="SUPER_ADMIN"), format="json")
        assert res.status_code == 201
        assert User.objects.get(email="new.hire@example.com").is_superuser

    def test_only_super_admin_may_grant_super_admin(self, monkeypatch):
        # ADMIN lacks staff.manage by design; give it here to prove the service-level guard holds on its own.
        monkeypatch.setitem(ROLE_CAPABILITIES, "ADMIN", ROLE_CAPABILITIES["ADMIN"] | {"staff.manage"})
        admin = make_staff("ADMIN")
        client = client_for(admin)
        res = client.post(URL, create_body(role="SUPER_ADMIN"), format="json")
        assert res.status_code == 403 and res.json()["error"]["code"] == "forbidden_role"
        assert not User.objects.filter(email="new.hire@example.com").exists()
        own = client.post(URL, create_body(role="SUPPORT_AGENT"), format="json")
        assert own.status_code == 201
        promote = client.patch(f"{URL}{own.json()['id']}/", {"role": "SUPER_ADMIN"}, format="json")
        assert promote.status_code == 403
        assert StaffProfile.objects.get(user_id=own.json()["id"]).role == "SUPPORT_AGENT"

    def test_non_super_admin_cannot_touch_super_admin(self, monkeypatch, sa):
        monkeypatch.setitem(ROLE_CAPABILITIES, "ADMIN", ROLE_CAPABILITIES["ADMIN"] | {"staff.manage"})
        admin = make_staff("ADMIN")
        make_staff("SUPER_ADMIN")  # a second one so "last" protection is not what blocks us
        client = client_for(admin)
        assert client.patch(f"{URL}{sa.pk}/", {"role": "ADMIN"}, format="json").status_code == 403
        assert client.post(f"{URL}{sa.pk}/deactivate/").status_code == 403
        sa.refresh_from_db()
        assert sa.is_active and sa.staff_profile.role == "SUPER_ADMIN"


class TestUpdate:
    def test_role_and_branch_change_is_audited(self, sa_client, sa):
        b1, b2 = make_branch(), make_branch()
        staff = make_staff("BRANCH_MANAGER", branches=[b1])
        res = sa_client.patch(
            f"{URL}{staff.pk}/",
            {"role": "ORDER_MANAGER", "branch_ids": [b2.pk], "job_title": "Shift lead"},
            format="json",
        )
        assert res.status_code == 200
        body = res.json()
        assert body["role"] == "ORDER_MANAGER" and body["branch_ids"] == [b2.pk] and body["job_title"] == "Shift lead"
        entry = AuditLog.objects.get(action="staff.update", resource_id=str(staff.pk))
        assert entry.actor_id == sa.pk
        assert entry.changes["role"] == {"from": "BRANCH_MANAGER", "to": "ORDER_MANAGER"}
        assert entry.changes["branch_ids"] == {"from": [b1.pk], "to": [b2.pk]}

    def test_role_change_takes_effect_immediately(self, sa_client):
        staff = make_staff("SUPPORT_AGENT")
        client = client_for(staff)
        assert client.get("/api/v1/admin/customers/").status_code == 200
        sa_client.patch(f"{URL}{staff.pk}/", {"role": "PRODUCT_MANAGER"}, format="json")
        assert client.get("/api/v1/admin/customers/").status_code == 403

    def test_switching_to_branch_scoped_role_requires_branch(self, sa_client):
        staff = make_staff("SUPPORT_AGENT")
        res = sa_client.patch(f"{URL}{staff.pk}/", {"role": "BRANCH_MANAGER"}, format="json")
        assert res.status_code == 400 and "branch_ids" in res.json()["error"]["fields"]
        staff.staff_profile.refresh_from_db()
        assert staff.staff_profile.role == "SUPPORT_AGENT"

    def test_customers_are_not_addressable_here(self, sa_client):
        customer = make_user()
        assert sa_client.get(f"{URL}{customer.pk}/").status_code == 404
        assert sa_client.patch(f"{URL}{customer.pk}/", {"role": "ADMIN"}, format="json").status_code == 404
        assert sa_client.post(f"{URL}{customer.pk}/deactivate/").status_code == 404

    def test_profile_fields_and_email_uniqueness(self, sa_client):
        make_user("taken@example.com")
        staff = make_staff("SUPPORT_AGENT")
        ok = sa_client.patch(f"{URL}{staff.pk}/", {"first_name": "Zed", "phone": "+1 555 010 0100"}, format="json")
        assert ok.status_code == 200 and ok.json()["first_name"] == "Zed"
        dup = sa_client.patch(f"{URL}{staff.pk}/", {"email": "TAKEN@example.com"}, format="json")
        assert dup.status_code == 400 and "email" in dup.json()["error"]["fields"]


class TestLastSuperAdmin:
    def test_cannot_demote_last_super_admin(self, sa_client, sa):
        res = sa_client.patch(f"{URL}{sa.pk}/", {"role": "ADMIN"}, format="json")
        assert res.status_code == 409 and res.json()["error"]["code"] == "last_super_admin"
        sa.staff_profile.refresh_from_db()
        assert sa.staff_profile.role == "SUPER_ADMIN"
        assert not AuditLog.objects.filter(action="staff.update").exists()  # the refused change left no trace

    def test_cannot_deactivate_last_super_admin(self, sa):
        actor = make_staff("SUPER_ADMIN")
        # deactivate the other one first (allowed: two exist), then the survivor is protected
        client = client_for(actor)
        assert client.post(f"{URL}{sa.pk}/deactivate/").status_code == 200
        res = client_for(actor).post(f"{URL}{actor.pk}/deactivate/")
        assert res.status_code == 409  # either "self" or "last super admin" protection must refuse
        actor.refresh_from_db()
        assert actor.is_active

    def test_inactive_super_admins_do_not_count(self, sa_client, sa):
        ghost = make_staff("SUPER_ADMIN")
        ghost.is_active = False
        ghost.save()
        res = sa_client.patch(f"{URL}{sa.pk}/", {"role": "ADMIN"}, format="json")
        assert res.status_code == 409 and res.json()["error"]["code"] == "last_super_admin"

    def test_can_demote_when_another_active_super_admin_exists(self, sa_client, sa):
        other = make_staff("SUPER_ADMIN")
        res = sa_client.patch(f"{URL}{other.pk}/", {"role": "ADMIN"}, format="json")
        assert res.status_code == 200 and res.json()["role"] == "ADMIN"
        other.refresh_from_db()
        assert not other.is_superuser
        # now sa is the last one again
        assert sa_client.patch(f"{URL}{sa.pk}/", {"role": "ADMIN"}, format="json").status_code == 409

    def test_second_super_admin_can_be_deactivated_by_first(self, sa_client):
        other = make_staff("SUPER_ADMIN")
        assert sa_client.post(f"{URL}{other.pk}/deactivate/").status_code == 200

    def test_last_super_admin_check_when_target_is_not_super_admin_is_irrelevant(self, sa_client):
        admin = make_staff("ADMIN")
        assert sa_client.post(f"{URL}{admin.pk}/deactivate/").status_code == 200


class TestDeactivate:
    def test_deactivate_audit_and_lockout_then_reactivate(self, sa_client, sa):
        staff = make_staff("SUPPORT_AGENT")
        staff_client = client_for(staff)
        assert staff_client.get("/api/v1/admin/customers/").status_code == 200
        res = sa_client.post(f"{URL}{staff.pk}/deactivate/")
        assert res.status_code == 200 and res.json()["is_active"] is False
        assert staff_client.get("/api/v1/admin/customers/").status_code == 401
        login = APIClient().post(
            "/api/v1/auth/login/", {"email": staff.email, "password": "Str0ng-pass-123"}, format="json"
        )
        assert login.status_code == 403
        entry = AuditLog.objects.get(action="staff.deactivate")
        assert entry.actor_id == sa.pk and entry.resource_id == str(staff.pk)
        assert sa_client.post(f"{URL}{staff.pk}/deactivate/").status_code == 200  # idempotent
        assert AuditLog.objects.filter(action="staff.deactivate").count() == 1
        back = sa_client.post(f"{URL}{staff.pk}/activate/")
        assert back.status_code == 200 and back.json()["is_active"] is True
        assert AuditLog.objects.filter(action="staff.activate").count() == 1
        assert staff_client.get("/api/v1/admin/customers/").status_code == 200

    def test_cannot_deactivate_self(self, sa_client, sa):
        make_staff("SUPER_ADMIN")
        res = sa_client.post(f"{URL}{sa.pk}/deactivate/")
        assert res.status_code == 409 and res.json()["error"]["code"] == "cannot_deactivate_self"
        sa.refresh_from_db()
        assert sa.is_active
