import itertools
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.permissions import ROLE_CAPABILITIES
from apps.core.models import AuditLog
from apps.core.testing import client_for
from tests.factories import make_address, make_branch, make_staff, make_user, make_zone

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/customers/"
ROLES = sorted(ROLE_CAPABILITIES)
_seq = itertools.count(1)


def make_order(
    customer, branch, total="10.00", *, status="COMPLETED", payment_status="PAID", method="demo", refunded="0.00"
):
    from apps.orders.models import Order

    n = next(_seq)
    return Order.objects.create(
        number=f"T-{n:06d}",
        customer=customer,
        branch=branch,
        order_type="PICKUP",
        status=status,
        payment_status=payment_status,
        payment_method=method,
        currency="USD",
        subtotal=Decimal(total),
        total=Decimal(total),
        refunded_total=Decimal(refunded),
        customer_name=customer.full_name,
        customer_email=customer.email,
        idempotency_key=f"key-{n}",
        placed_at=timezone.now(),
    )


def by_email(res):
    return {row["email"]: row for row in res.json()["results"]}


class TestPermissions:
    @pytest.mark.parametrize("role", ROLES)
    def test_list_matrix(self, role):
        branch = make_branch()
        staff = make_staff(role, branches=[branch])
        res = client_for(staff).get(URL)
        assert res.status_code == (200 if "customers.view" in ROLE_CAPABILITIES[role] else 403)

    @pytest.mark.parametrize("role", ROLES)
    def test_suspend_matrix(self, role):
        branch = make_branch()
        customer = make_user()
        make_order(customer, branch)
        staff = make_staff(role, branches=[branch])
        res = client_for(staff).post(f"{URL}{customer.pk}/suspend/", {"reason": "abuse"}, format="json")
        allowed = "customers.manage" in ROLE_CAPABILITIES[role]
        assert res.status_code == (200 if allowed else 403)
        customer.refresh_from_db()
        assert customer.is_active is (not allowed)

    def test_anonymous_gets_401(self):
        assert APIClient().get(URL).status_code == 401
        assert APIClient().post(f"{URL}1/suspend/", {"reason": "x"}, format="json").status_code == 401

    def test_customer_gets_403(self):
        assert client_for(make_user()).get(URL).status_code == 403

    def test_inactive_staff_is_locked_out(self):
        admin = make_staff("ADMIN")
        client = client_for(admin)
        admin.is_active = False
        admin.save()
        assert client.get(URL).status_code == 401


class TestListAndDetail:
    def test_never_leaks_password_hash_or_staff(self):
        customer = make_user("cust@example.com")
        make_staff("ADMIN", email="boss@example.com")
        admin = make_staff("SUPER_ADMIN")
        client = client_for(admin)
        listing = client.get(URL)
        detail = client.get(f"{URL}{customer.pk}/")
        for res in (listing, detail):
            text = res.content.decode()
            assert "password" not in text and "pbkdf2" not in text and "md5$" not in text
            assert customer.password not in text
        assert [r["email"] for r in listing.json()["results"]] == ["cust@example.com"]

    def test_staff_id_is_404_here(self):
        boss = make_staff("ADMIN")
        reader = make_staff("SUPPORT_AGENT")
        client = client_for(reader)
        assert client.get(f"{URL}{boss.pk}/").status_code == 404
        manager = client_for(make_staff("SUPER_ADMIN"))
        res = manager.post(f"{URL}{boss.pk}/suspend/", {"reason": "x"}, format="json")
        assert res.status_code == 404  # staff accounts can never be suspended through the customer API
        boss.refresh_from_db()
        assert boss.is_active

    def test_aggregates_count_only_completed_paid_orders(self):
        branch = make_branch()
        customer = make_user("agg@example.com")
        make_order(customer, branch, "20.00")  # counted
        make_order(customer, branch, "30.00", payment_status="PARTIALLY_REFUNDED", refunded="5.00")  # counted, net 25
        make_order(customer, branch, "11.00", payment_status="PENDING", method="cash")  # cash completed: counted
        make_order(customer, branch, "99.00", status="CANCELLED", payment_status="PAID")  # not counted
        make_order(customer, branch, "88.00", status="PREPARING", payment_status="PAID")  # not completed
        make_order(customer, branch, "77.00", payment_status="PENDING")  # online payment never settled
        empty = make_user("none@example.com")
        res = client_for(make_staff("ADMIN")).get(URL)
        rows = by_email(res)
        assert rows["agg@example.com"]["order_count"] == 3
        assert Decimal(rows["agg@example.com"]["lifetime_spend"]) == Decimal("56.00")
        assert rows["agg@example.com"]["last_order_at"] is not None
        assert rows["none@example.com"]["order_count"] == 0
        assert Decimal(rows["none@example.com"]["lifetime_spend"]) == Decimal("0")
        assert rows["none@example.com"]["last_order_at"] is None
        assert empty.pk

    def test_search_filter_and_ordering(self):
        branch = make_branch()
        a = make_user("alice@example.com", first_name="Alice", last_name="Smith", phone="+15550111")
        b = make_user("bob@example.com", first_name="Bob", last_name="Jones", phone="+15550222")
        c = make_user("carol@example.com", first_name="Carol", last_name="Smith")
        c.is_active = False
        c.save()
        make_order(b, branch, "50.00")
        make_order(a, branch, "10.00")
        client = client_for(make_staff("ADMIN"))
        assert set(by_email(client.get(URL, {"search": "smith"}))) == {"alice@example.com", "carol@example.com"}
        assert set(by_email(client.get(URL, {"search": "alice smith"}))) == {"alice@example.com"}
        assert set(by_email(client.get(URL, {"search": "+15550222"}))) == {"bob@example.com"}
        assert set(by_email(client.get(URL, {"search": "BOB@"}))) == {"bob@example.com"}
        assert set(by_email(client.get(URL, {"is_active": "false"}))) == {"carol@example.com"}
        assert set(by_email(client.get(URL, {"is_active": "true"}))) == {"alice@example.com", "bob@example.com"}
        ordered = client.get(URL, {"ordering": "-lifetime_spend"}).json()["results"]
        assert [r["email"] for r in ordered][:2] == ["bob@example.com", "alice@example.com"]
        assert client.get(URL, {"ordering": "password"}).status_code == 200  # unknown ordering keys are ignored

    def test_pagination_envelope(self):
        for _ in range(3):
            make_user()
        body = client_for(make_staff("ADMIN")).get(URL, {"page_size": 2}).json()
        assert body["count"] == 3 and len(body["results"]) == 2 and body["next"]

    def test_detail_contains_addresses_and_recent_orders(self):
        branch = make_branch()
        customer = make_user("detail@example.com")
        zone = make_zone("Harbour")
        keep = make_address(customer, zone, is_default=True)
        gone = make_address(customer, is_deleted=True)
        for i in range(12):
            make_order(customer, branch, f"{i + 1}.00")
        body = client_for(make_staff("SUPPORT_AGENT")).get(f"{URL}{customer.pk}/").json()
        assert [a["id"] for a in body["addresses"]] == [keep.pk] and gone.pk not in [a["id"] for a in body["addresses"]]
        assert body["addresses"][0]["zone_name"] == "Harbour"
        assert len(body["recent_orders"]) == 10
        assert body["recent_orders"][0]["number"].startswith("T-")
        assert set(body["recent_orders"][0]) == {
            "number",
            "status",
            "payment_status",
            "order_type",
            "total",
            "currency",
            "branch_name",
            "placed_at",
        }
        assert body["is_active"] is True and body["restriction_reason"] == ""

    def test_unknown_customer_404(self):
        assert client_for(make_staff("ADMIN")).get(f"{URL}999999/").status_code == 404


class TestBranchManagerScope:
    def test_branch_manager_sees_only_customers_with_orders_at_their_branches(self):
        mine, theirs = make_branch(), make_branch()
        manager = make_staff("BRANCH_MANAGER", branches=[mine])
        local = make_user("local@example.com")
        away = make_user("away@example.com")
        both = make_user("both@example.com")
        make_user("never@example.com")
        make_order(local, mine, "10.00")
        make_order(away, theirs, "10.00")
        make_order(both, mine, "15.00")
        make_order(both, theirs, "100.00")
        client = client_for(manager)
        rows = by_email(client.get(URL))
        assert set(rows) == {"local@example.com", "both@example.com"}
        assert Decimal(rows["both@example.com"]["lifetime_spend"]) == Decimal("15.00")  # only their branch's orders
        assert rows["both@example.com"]["order_count"] == 1
        assert client.get(f"{URL}{local.pk}/").status_code == 200
        assert client.get(f"{URL}{away.pk}/").status_code == 404
        detail = client.get(f"{URL}{both.pk}/").json()
        assert len(detail["recent_orders"]) == 1

    def test_order_manager_and_support_have_global_visibility(self):
        branch, other = make_branch(), make_branch()
        customer = make_user("elsewhere@example.com")
        make_order(customer, other)
        for role in ("ORDER_MANAGER", "SUPPORT_AGENT"):
            staff = make_staff(role, branches=[branch])
            assert "elsewhere@example.com" in by_email(client_for(staff).get(URL))

    def test_branch_manager_cannot_suspend_out_of_scope_customer(self):
        mine, theirs = make_branch(), make_branch()
        manager = make_staff("BRANCH_MANAGER", branches=[mine])
        away = make_user()
        make_order(away, theirs)
        # BRANCH_MANAGER lacks customers.manage anyway, and out-of-scope customers are invisible
        assert client_for(manager).post(f"{URL}{away.pk}/suspend/", {"reason": "x"}, format="json").status_code == 403


class TestSuspendRestore:
    def test_suspend_audit_and_lockout(self):
        customer = make_user("sus@example.com")
        customer_client = client_for(customer)
        assert customer_client.get("/api/v1/account/").status_code == 200
        admin = make_staff("ADMIN")
        res = client_for(admin).post(f"{URL}{customer.pk}/suspend/", {"reason": "Fraud review"}, format="json")
        assert res.status_code == 200
        body = res.json()
        assert body["is_active"] is False and body["restriction_reason"] == "Fraud review"
        customer.refresh_from_db()
        assert customer.is_active is False
        entry = AuditLog.objects.get(action="customer.suspend")
        assert entry.actor_id == admin.pk and entry.resource_id == str(customer.pk)
        assert entry.changes == {"reason": "Fraud review"} and "sus@example.com" in entry.summary
        # existing session dies immediately and login now explains why
        assert customer_client.get("/api/v1/account/").status_code == 401
        login = APIClient().post(
            "/api/v1/auth/login/", {"email": "sus@example.com", "password": "Str0ng-pass-123"}, format="json"
        )
        assert login.status_code == 403 and login.json()["error"]["code"] == "account_restricted"

    def test_reason_required(self):
        customer = make_user()
        res = client_for(make_staff("ADMIN")).post(f"{URL}{customer.pk}/suspend/", {}, format="json")
        assert res.status_code == 400 and "reason" in res.json()["error"]["fields"]
        customer.refresh_from_db()
        assert customer.is_active

    def test_restore(self):
        customer = make_user()
        customer.is_active = False
        customer.restriction_reason = "old reason"
        customer.save()
        admin = make_staff("ADMIN")
        res = client_for(admin).post(f"{URL}{customer.pk}/restore/")
        assert res.status_code == 200 and res.json()["is_active"] is True and res.json()["restriction_reason"] == ""
        customer.refresh_from_db()
        assert customer.is_active and customer.restriction_reason == ""
        assert AuditLog.objects.filter(action="customer.restore", resource_id=str(customer.pk)).count() == 1

    def test_repeat_is_idempotent_without_duplicate_audit(self):
        customer = make_user()
        client = client_for(make_staff("ADMIN"))
        for _ in range(2):
            assert client.post(f"{URL}{customer.pk}/suspend/", {"reason": "r"}, format="json").status_code == 200
        assert AuditLog.objects.filter(action="customer.suspend").count() == 1
        for _ in range(2):
            assert client.post(f"{URL}{customer.pk}/restore/").status_code == 200
        assert AuditLog.objects.filter(action="customer.restore").count() == 1

    def test_suspended_customers_remain_listed(self):
        customer = make_user()
        client = client_for(make_staff("ADMIN"))
        client.post(f"{URL}{customer.pk}/suspend/", {"reason": "r"}, format="json")
        rows = client.get(URL, {"is_active": "false"}).json()["results"]
        assert [r["id"] for r in rows] == [customer.pk]
