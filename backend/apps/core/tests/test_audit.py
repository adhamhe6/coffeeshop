from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.permissions import ROLE_CAPABILITIES
from apps.core.audit import audit
from apps.core.models import AuditLog
from apps.core.testing import client_for
from tests.factories import make_branch, make_staff, make_user

pytestmark = pytest.mark.django_db

URL = "/api/v1/admin/audit-logs/"
ROLES = sorted(ROLE_CAPABILITIES)


def entry(actor=None, action="thing.update", rtype="catalog.Product", rid="1", summary="", age_days=0, **kw):
    log = audit(actor, action, None, resource_type=rtype, resource_id=rid, summary=summary, **kw)
    if age_days:  # the log is append-only (even update() is blocked), so backdate through the DB layer directly
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE core_auditlog SET created_at = %s WHERE id = %s",
                [timezone.now() - timedelta(days=age_days), log.pk],
            )
    return log


class TestImmutability:
    def test_instance_cannot_be_modified(self):
        log = entry(summary="original")
        log.summary = "tampered"
        with pytest.raises(ValidationError):
            log.save()
        assert AuditLog.objects.get(pk=log.pk).summary == "original"

    def test_instance_cannot_be_deleted(self):
        log = entry()
        with pytest.raises(ValidationError):
            log.delete()
        assert AuditLog.objects.filter(pk=log.pk).exists()

    def test_queryset_update_and_delete_blocked(self):
        entry()
        with pytest.raises(ValidationError):
            AuditLog.objects.all().update(summary="x")
        with pytest.raises(ValidationError):
            AuditLog.objects.all().delete()
        assert AuditLog.objects.count() == 1

    def test_secrets_are_scrubbed(self):
        log = entry(changes={"password": "hunter2", "nested": {"api_token": "abc", "ok": 1}, "card_number": "4242"})
        assert log.changes["password"] == "[redacted]"
        assert log.changes["nested"] == {"api_token": "[redacted]", "ok": 1}
        assert log.changes["card_number"] == "[redacted]"

    def test_actor_label_survives_actor_deletion(self):
        staff = make_staff("ADMIN", email="gone@example.com")
        log = entry(staff)
        staff.delete()
        log.refresh_from_db()
        assert log.actor_id is None and log.actor_label == "gone@example.com"


class TestAuditApi:
    @pytest.mark.parametrize("role", ROLES)
    def test_permission_matrix(self, role):
        actor = make_staff(role, branches=[make_branch()])
        res = client_for(actor).get(URL)
        assert res.status_code == (200 if "audit.view" in ROLE_CAPABILITIES[role] else 403)

    def test_anonymous_and_customer(self):
        assert APIClient().get(URL).status_code == 401
        assert client_for(make_user()).get(URL).status_code == 403

    def test_no_write_endpoints(self):
        admin = make_staff("SUPER_ADMIN")
        log = entry()
        client = client_for(admin)
        assert client.post(URL, {"action": "x"}, format="json").status_code == 405
        assert client.put(f"{URL}{log.pk}/", {"action": "x"}, format="json").status_code == 405
        assert client.patch(f"{URL}{log.pk}/", {"action": "x"}, format="json").status_code == 405
        assert client.delete(f"{URL}{log.pk}/").status_code == 405
        assert AuditLog.objects.get(pk=log.pk).action == "thing.update"

    def test_newest_first_and_envelope(self):
        client = client_for(make_staff("ADMIN"))
        old = entry(summary="old", age_days=3)
        new = entry(summary="new")
        mid = entry(summary="mid", age_days=1)
        body = client.get(URL).json()
        assert set(body) == {"count", "next", "previous", "results"}
        ids = [r["id"] for r in body["results"]]
        assert ids == [new.pk, mid.pk, old.pk]
        assert set(body["results"][0]) >= {
            "actor",
            "actor_label",
            "action",
            "resource_type",
            "resource_id",
            "summary",
            "changes",
            "created_at",
        }
        assert client.get(URL, {"ordering": "created_at"}).json()["results"][0]["id"] == old.pk

    def test_filters(self):
        admin, other = make_staff("ADMIN"), make_staff("MARKETING_MANAGER")
        a = entry(admin, "product.update", "catalog.Product", "5", "Changed price of Latte")
        b = entry(other, "coupon.create", "promotions.Coupon", "9", "Created coupon SPRING", age_days=10)
        c = entry(other, "product.update", "catalog.Product", "6", "Changed name", age_days=2)
        client = client_for(make_staff("SUPER_ADMIN"))

        def ids(**params):
            return {r["id"] for r in client.get(URL, params).json()["results"]}

        assert ids(actor=admin.pk) == {a.pk}
        assert ids(actor=other.pk) == {b.pk, c.pk}
        assert ids(action="product.update") == {a.pk, c.pk}
        assert ids(resource_type="promotions.Coupon") == {b.pk}
        assert ids(resource_type="catalog.Product", resource_id="6") == {c.pk}
        assert ids(search="latte") == {a.pk}
        assert ids(search="marketing") == {b.pk, c.pk}
        today = timezone.now().date()
        assert ids(date_from=(today - timedelta(days=3)).isoformat()) == {a.pk, c.pk}
        assert ids(date_to=(today - timedelta(days=5)).isoformat()) == {b.pk}
        assert ids(
            date_from=(today - timedelta(days=11)).isoformat(), date_to=(today - timedelta(days=1)).isoformat()
        ) == {b.pk, c.pk}
        assert client.get(URL, {"date_from": "not-a-date"}).status_code == 400

    def test_detail(self):
        log = entry(changes={"price": {"from": "4.00", "to": "4.50"}})
        res = client_for(make_staff("ADMIN")).get(f"{URL}{log.pk}/")
        assert res.status_code == 200 and res.json()["changes"]["price"]["to"] == "4.50"
