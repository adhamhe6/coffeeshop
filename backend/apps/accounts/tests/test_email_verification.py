"""Finding S9: lightweight, purchase-friendly email verification."""

import importlib
import re
from datetime import timedelta

import pytest
from django.core import mail, signing
from freezegun import freeze_time
from rest_framework.throttling import ScopedRateThrottle

from apps.accounts import services
from apps.accounts.models import StaffProfile, User
from apps.core.testing import client_for
from tests.factories import make_staff, make_user

pytestmark = pytest.mark.django_db

VERIFY = "/api/v1/auth/verify-email/"
RESEND = "/api/v1/auth/resend-verification/"
REGISTER = "/api/v1/auth/register/"
GOOD_PASSWORD = "Tr1cky-horse-staple"


def register(client=None, email="newbie@example.com"):
    client = client or client_for()
    res = client.post(
        REGISTER,
        {"email": email, "password": GOOD_PASSWORD, "first_name": "New", "last_name": "Bie", "marketing_opt_in": True},
        format="json",
    )
    assert res.status_code == 201, res.content
    return client, res


def token_from(message) -> str:
    match = re.search(r"/verify-email\?token=([^\s\"'<>&]+)", message.body)
    assert match, message.body
    return match.group(1)


class TestRegistrationFlow:
    def test_register_sends_a_branded_verification_email_and_account_starts_unverified(self):
        client, res = register()
        assert res.json()["email_verified"] is False
        assert User.objects.get(email="newbie@example.com").email_verified_at is None
        (message,) = mail.outbox
        assert message.to == ["newbie@example.com"] and "Confirm your email" in message.subject
        html, mime = message.alternatives[0]
        assert mime == "text/html" and "<table" in html
        token = token_from(message)
        assert f"http://localhost:5173/verify-email?token={token}" in message.body
        assert f"verify-email?token={token}" in html

    def test_full_flow_register_then_follow_the_link_while_signed_out(self):
        _, res = register()
        token = token_from(mail.outbox[0])
        stranger = client_for()  # a different browser, nobody signed in
        ok = stranger.post(VERIFY, {"token": token}, format="json")
        assert ok.status_code == 200 and ok.json() == {"detail": ok.json()["detail"], "email_verified": True}
        assert User.objects.get(email="newbie@example.com").email_verified_at is not None
        user = User.objects.get(email="newbie@example.com")
        me = client_for(user).get("/api/v1/auth/me/").json()
        assert me["user"]["email_verified"] is True

    def test_login_and_me_payloads_expose_the_flag(self):
        user = make_user("login@example.com", unverified=True)
        login = client_for().post(
            "/api/v1/auth/login/", {"email": "login@example.com", "password": "Str0ng-pass-123"}, format="json"
        )
        assert login.status_code == 200 and login.json()["user"]["email_verified"] is False
        assert client_for(user).get("/api/v1/auth/me/").json()["user"]["email_verified"] is False
        assert client_for(make_user()).get("/api/v1/account/").json()["email_verified"] is True

    def test_broker_outage_does_not_break_registration(self, monkeypatch):
        from apps.accounts import tasks

        def down(*a, **k):
            raise ConnectionError("redis down")

        monkeypatch.setattr(tasks.send_verification_email, "delay", down)
        _, res = register()
        assert res.status_code == 201 and mail.outbox == []


class TestVerifyEndpoint:
    def test_is_idempotent(self):
        user = make_user(unverified=True)
        token = services.make_verification_token(user)
        first = client_for().post(VERIFY, {"token": token}, format="json")
        stamp = User.objects.get(pk=user.pk).email_verified_at
        second = client_for().post(VERIFY, {"token": token}, format="json")
        assert first.status_code == second.status_code == 200
        assert User.objects.get(pk=user.pk).email_verified_at == stamp  # the original timestamp is kept

    @pytest.mark.parametrize("token", ["", "garbage", "a:b:c", "x" * 600])
    def test_garbage_is_rejected(self, token):
        res = client_for().post(VERIFY, {"token": token}, format="json")
        assert res.status_code == 400
        assert res.json()["error"]["code"] in {"invalid_token", "validation_error", "invalid"}

    def test_missing_token_is_a_validation_error(self):
        assert client_for().post(VERIFY, {}, format="json").status_code == 400

    def test_tampered_token_is_rejected(self):
        user = make_user(unverified=True)
        token = services.make_verification_token(user)
        flipped = token[:-2] + ("AA" if not token.endswith("AA") else "BB")
        res = client_for().post(VERIFY, {"token": flipped}, format="json")
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_token"
        assert User.objects.get(pk=user.pk).email_verified_at is None

    def test_token_signed_with_another_salt_is_rejected(self):
        user = make_user(unverified=True)
        forged = signing.dumps({"uid": user.pk, "email": user.email}, salt="something-else")
        assert client_for().post(VERIFY, {"token": forged}, format="json").status_code == 400
        assert User.objects.get(pk=user.pk).email_verified_at is None

    def test_cannot_verify_somebody_else_by_swapping_the_uid(self):
        mine = make_user(unverified=True)
        victim = make_user(unverified=True)
        payload = signing.loads(services.make_verification_token(mine), salt=services.VERIFY_SALT)
        assert payload["uid"] == mine.pk
        # Without the secret key a token for the victim cannot be produced; an unsigned/foreign payload is refused.
        forged = signing.b64_encode(f'{{"uid":{victim.pk},"email":"{victim.email}"}}'.encode()).decode()
        assert client_for().post(VERIFY, {"token": forged}, format="json").status_code == 400
        assert User.objects.get(pk=victim.pk).email_verified_at is None

    def test_expires_after_three_days(self):
        user = make_user(unverified=True)
        with freeze_time("2026-10-10 12:00:00"):
            token = services.make_verification_token(user)
        with freeze_time("2026-10-13 11:59:00"):
            assert client_for().post(VERIFY, {"token": token}, format="json").status_code == 200
        User.objects.filter(pk=user.pk).update(email_verified_at=None)
        with freeze_time("2026-10-13 12:01:00"):
            res = client_for().post(VERIFY, {"token": token}, format="json")
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_token"
        assert User.objects.get(pk=user.pk).email_verified_at is None

    def test_a_link_is_void_once_the_email_changed(self):
        user = make_user("before@example.com", unverified=True)
        token = services.make_verification_token(user)
        User.objects.filter(pk=user.pk).update(email="after@example.com")
        res = client_for().post(VERIFY, {"token": token}, format="json")
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_token"
        assert User.objects.get(pk=user.pk).email_verified_at is None

    def test_inactive_accounts_cannot_verify(self):
        user = make_user(unverified=True, is_active=False)
        res = client_for().post(VERIFY, {"token": services.make_verification_token(user)}, format="json")
        assert res.status_code == 400

    def test_is_throttled(self, monkeypatch):
        monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "verify", "2/hour")
        codes = [client_for().post(VERIFY, {"token": "x"}, format="json").status_code for _ in range(3)]
        assert codes == [400, 400, 429]


class TestResend:
    def test_requires_sign_in(self):
        assert client_for().post(RESEND).status_code in (401, 403)

    def test_sends_a_fresh_link_to_the_current_address(self):
        user = make_user("resend@example.com", unverified=True)
        res = client_for(user).post(RESEND)
        assert res.status_code == 202 and res.json()["email_verified"] is False
        (message,) = mail.outbox
        assert message.to == ["resend@example.com"]
        assert client_for().post(VERIFY, {"token": token_from(message)}, format="json").status_code == 200

    def test_is_a_noop_for_verified_users(self):
        res = client_for(make_user()).post(RESEND)
        assert res.status_code == 200 and res.json()["email_verified"] is True
        assert mail.outbox == []

    def test_is_throttled_per_user(self, monkeypatch):
        monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "resend_verification", "2/hour")
        user = make_user(unverified=True)
        client = client_for(user)
        assert [client.post(RESEND).status_code for _ in range(3)] == [202, 202, 429]
        assert len(mail.outbox) == 2
        other = client_for(make_user(unverified=True))
        assert other.post(RESEND).status_code == 202  # another user has their own budget


class TestEmailChange:
    URL = "/api/v1/account/"

    def change(self, user, new_email="fresh@example.com", client=None):
        client = client or client_for(user)
        return client.patch(self.URL, {"email": new_email, "current_password": "Str0ng-pass-123"}, format="json")

    def test_change_resets_verification_and_mails_the_new_address(self):
        user = make_user("old@example.com")
        res = self.change(user)
        assert res.status_code == 200
        body = res.json()
        assert body["email"] == "fresh@example.com" and body["email_verified"] is False
        user.refresh_from_db()
        assert user.email_verified_at is None
        (message,) = mail.outbox
        assert message.to == ["fresh@example.com"]
        assert client_for().post(VERIFY, {"token": token_from(message)}, format="json").status_code == 200
        user.refresh_from_db()
        assert user.email_verified_at is not None

    def test_old_link_does_not_verify_the_new_address(self):
        user = make_user("old@example.com", unverified=True)
        stale = services.make_verification_token(user)
        self.change(user)
        assert client_for().post(VERIFY, {"token": stale}, format="json").status_code == 400
        user.refresh_from_db()
        assert user.email_verified_at is None

    def test_other_profile_changes_keep_verification(self):
        user = make_user()
        res = client_for(user).patch(self.URL, {"first_name": "Zed"}, format="json")
        assert res.status_code == 200 and res.json()["email_verified"] is True
        assert mail.outbox == []

    def test_resubmitting_the_same_email_changes_nothing(self):
        user = make_user("same@example.com")
        res = client_for(user).patch(self.URL, {"email": "SAME@example.com"}, format="json")
        assert res.status_code == 200 and res.json()["email_verified"] is True and mail.outbox == []

    def test_email_changes_are_throttled(self, monkeypatch):
        from rest_framework.throttling import UserRateThrottle

        monkeypatch.setitem(UserRateThrottle.THROTTLE_RATES, "email_change", "2/hour")
        user = make_user("start@example.com")
        client = client_for(user)
        codes = []
        for i in range(3):
            codes.append(self.change(user, f"hop{i}@example.com", client).status_code)
            user.refresh_from_db()
        # the password check still works because the throttle sits after validation
        assert codes == [200, 200, 429]
        assert len(mail.outbox) == 2


class TestPasswordResetProvesOwnership:
    def test_confirming_a_reset_marks_the_address_verified(self):
        user = make_user("reset@example.com", unverified=True)
        client = client_for()
        client.post("/api/v1/auth/password-reset/", {"email": "reset@example.com"}, format="json")
        (message,) = mail.outbox  # reset mail goes to unverified addresses too: that is its purpose
        assert message.to == ["reset@example.com"]
        link = re.search(r"uid=([^&\s]+)&token=([^\s]+)", message.body)
        res = client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": link.group(1), "token": link.group(2), "new_password": "Brand-new-passw0rd"},
            format="json",
        )
        assert res.status_code == 200
        user.refresh_from_db()
        assert user.email_verified_at is not None

    def test_a_failed_reset_does_not_verify(self):
        user = make_user("nope@example.com", unverified=True)
        res = client_for().post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": "MQ", "token": "bad", "new_password": "Brand-new-passw0rd"},
            format="json",
        )
        assert res.status_code == 400
        user.refresh_from_db()
        assert user.email_verified_at is None


class TestVerifiedByDefaultWhereAnAdminVouches:
    def test_factories(self):
        assert make_user().email_verified is True
        assert make_staff("ADMIN").email_verified is True
        assert make_user(unverified=True).email_verified is False

    def test_createsuperuser_is_verified(self):
        assert User.objects.create_superuser("root@example.com", "x-Strong-pass-1").email_verified is True

    def test_plain_create_user_is_not(self):
        assert User.objects.create_user("plain@example.com", "x-Strong-pass-1").email_verified is False

    def test_staff_created_through_the_admin_api_are_verified(self):
        admin = make_staff("SUPER_ADMIN")
        res = client_for(admin).post(
            "/api/v1/admin/staff/",
            {
                "email": "hire@example.com",
                "first_name": "New",
                "last_name": "Hire",
                "password": "Temp0rary-Passw0rd",
                "role": "PRODUCT_MANAGER",
            },
            format="json",
        )
        assert res.status_code == 201
        assert User.objects.get(email="hire@example.com").email_verified is True
        assert mail.outbox == []

    def test_data_migration_verifies_existing_staff_only(self):
        migration = importlib.import_module("apps.accounts.migrations.0002_email_verification")
        from django.apps import apps as django_apps

        staff = make_user("old-staff@example.com", unverified=True, is_staff=True)
        profiled = make_user("old-profile@example.com", unverified=True)
        StaffProfile.objects.create(user=profiled, role="SUPPORT_AGENT")
        customer = make_user("old-customer@example.com", unverified=True)
        migration.verify_existing_staff(django_apps, None)
        for user, expected in ((staff, True), (profiled, True), (customer, False)):
            user.refresh_from_db()
            assert (user.email_verified_at is not None) is expected


class TestMarketingHelper:
    def test_requires_verification_and_opt_in(self):
        assert not services.can_send_marketing_email(make_user(unverified=True, marketing_opt_in=True))
        assert not services.can_send_marketing_email(make_user(marketing_opt_in=False))
        assert services.can_send_marketing_email(make_user(marketing_opt_in=True))
        assert not services.can_email(None)
        assert not services.can_email(make_user(is_active=False))


def test_token_is_bound_to_the_user_and_address():
    user = make_user("bound@example.com", unverified=True)
    data = signing.loads(services.make_verification_token(user), salt=services.VERIFY_SALT)
    assert data == {"uid": user.pk, "email": "bound@example.com"}
    assert timedelta(days=3).total_seconds() == services.VERIFY_MAX_AGE


def test_openapi_schema_documents_the_endpoints_and_validates(tmp_path):
    from django.core.management import call_command

    out = tmp_path / "schema.yml"
    call_command("spectacular", "--validate", "--fail-on-warn", "--file", str(out))
    text = out.read_text()
    assert "/api/v1/auth/verify-email/:" in text and "/api/v1/auth/resend-verification/:" in text
    assert "email_verified" in text
