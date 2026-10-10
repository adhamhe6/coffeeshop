import re
import sys
import types

import pytest
from django.conf import settings
from django.core import mail
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from apps.accounts.models import User
from apps.core.models import AuditLog, StoreSettings
from apps.core.testing import client_for
from tests.factories import make_branch, make_staff, make_user

pytestmark = pytest.mark.django_db

GOOD_PASSWORD = "Tr1cky-horse-staple"


def register_payload(**over):
    data = {
        "email": "Jane.Doe@Example.com",
        "password": GOOD_PASSWORD,
        "first_name": "Jane",
        "last_name": "Doe",
        "phone": "+1 555 010 0199",
        "marketing_opt_in": True,
    }
    data.update(over)
    return data


@pytest.fixture
def anon():
    return APIClient()


@pytest.fixture
def fake_cart(monkeypatch):
    """Install a stand-in for apps.cart.services (owned by another team) and record merges."""
    calls = []
    module = types.ModuleType("apps.cart.services")
    module.merge_guest_cart = lambda request, user: calls.append((request, user))
    monkeypatch.setitem(sys.modules, "apps.cart.services", module)
    return calls


# ── CSRF ────────────────────────────────────────────────────────────────────
class TestCsrf:
    def test_csrf_endpoint_sets_cookie(self, anon):
        res = anon.get("/api/v1/auth/csrf/")
        assert res.status_code == 204
        assert settings.CSRF_COOKIE_NAME in res.cookies

    def test_login_requires_csrf_token_when_enforced(self):
        make_user("csrf@example.com")
        client = APIClient(enforce_csrf_checks=True)
        body = {"email": "csrf@example.com", "password": "Str0ng-pass-123"}
        res = client.post("/api/v1/auth/login/", body, format="json")
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "csrf_failed"
        token = client.get("/api/v1/auth/csrf/").cookies[settings.CSRF_COOKIE_NAME].value
        ok = client.post("/api/v1/auth/login/", body, format="json", HTTP_X_CSRFTOKEN=token)
        assert ok.status_code == 200

    def test_register_requires_csrf_token_when_enforced(self):
        client = APIClient(enforce_csrf_checks=True)
        res = client.post("/api/v1/auth/register/", register_payload(), format="json")
        assert res.status_code == 403
        assert not User.objects.filter(email="jane.doe@example.com").exists()


# ── registration ─────────────────────────────────────────────────────────────
class TestRegister:
    def test_success_logs_in_and_normalises_email(self, anon):
        res = anon.post("/api/v1/auth/register/", register_payload(), format="json")
        assert res.status_code == 201
        body = res.json()
        assert body["email"] == "jane.doe@example.com"
        assert "password" not in body
        user = User.objects.get(email="jane.doe@example.com")
        assert user.check_password(GOOD_PASSWORD)
        assert user.marketing_opt_in is True
        assert not user.is_staff
        me = anon.get("/api/v1/auth/me/").json()
        assert me["authenticated"] is True and me["user"]["id"] == user.pk and me["staff"] is None

    def test_rotates_session_key(self, anon):
        session = anon.session
        session["guest"] = "data"
        session.save()
        old_key = session.session_key
        anon.cookies[settings.SESSION_COOKIE_NAME] = old_key
        res = anon.post("/api/v1/auth/register/", register_payload(), format="json")
        assert res.status_code == 201
        assert res.cookies[settings.SESSION_COOKIE_NAME].value != old_key

    def test_duplicate_email_is_case_insensitive(self, anon):
        make_user("jane.doe@example.com")
        res = anon.post("/api/v1/auth/register/", register_payload(email="JANE.DOE@EXAMPLE.COM"), format="json")
        assert res.status_code == 400
        err = res.json()["error"]
        assert err["code"] == "validation_error" and "email" in err["fields"]
        assert User.objects.filter(email__iexact="jane.doe@example.com").count() == 1

    @pytest.mark.parametrize("password", ["short1", "password1234", "1234567890123"])
    def test_weak_passwords_rejected(self, anon, password):
        res = anon.post("/api/v1/auth/register/", register_payload(password=password, email="jd@x.com"), format="json")
        assert res.status_code == 400
        assert "password" in res.json()["error"]["fields"]
        assert not User.objects.filter(email="jd@x.com").exists()

    def test_password_similar_to_email_rejected(self, anon):
        res = anon.post(
            "/api/v1/auth/register/",
            register_payload(email="unique.person@example.com", password="unique.person@example"),
            format="json",
        )
        assert res.status_code == 400 and "password" in res.json()["error"]["fields"]

    @pytest.mark.parametrize("field", ["email", "password", "first_name", "last_name"])
    def test_required_fields(self, anon, field):
        data = register_payload()
        data.pop(field)
        res = anon.post("/api/v1/auth/register/", data, format="json")
        assert res.status_code == 400 and field in res.json()["error"]["fields"]

    def test_invalid_phone_and_email(self, anon):
        res = anon.post("/api/v1/auth/register/", register_payload(phone="abc", email="nope"), format="json")
        fields = res.json()["error"]["fields"]
        assert res.status_code == 400 and "phone" in fields and "email" in fields

    def test_cannot_mass_assign_privileges(self, anon):
        data = register_payload(is_staff=True, is_superuser=True, is_active=False)
        assert anon.post("/api/v1/auth/register/", data, format="json").status_code == 201
        user = User.objects.get(email="jane.doe@example.com")
        assert not user.is_staff and not user.is_superuser and user.is_active

    def test_merges_guest_cart(self, anon, fake_cart):
        anon.post("/api/v1/auth/register/", register_payload(), format="json")
        assert len(fake_cart) == 1
        assert fake_cart[0][1].email == "jane.doe@example.com"

    def test_works_without_cart_app(self, anon, monkeypatch):
        monkeypatch.setitem(sys.modules, "apps.cart.services", None)  # import raises ImportError
        assert anon.post("/api/v1/auth/register/", register_payload(), format="json").status_code == 201

    def test_throttled(self, anon, monkeypatch):
        monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "register", "2/min")
        codes = [  # fresh client each time: an authenticated session would be throttled by user id instead of IP
            APIClient()
            .post("/api/v1/auth/register/", register_payload(email=f"t{i}@example.com"), format="json")
            .status_code
            for i in range(3)
        ]
        assert codes == [201, 201, 429]


# ── login / logout / me ──────────────────────────────────────────────────────
class TestLogin:
    def test_success(self, anon):
        user = make_user("cust@example.com")
        res = anon.post(
            "/api/v1/auth/login/", {"email": "CUST@example.com", "password": "Str0ng-pass-123"}, format="json"
        )
        assert res.status_code == 200
        body = res.json()
        assert body["authenticated"] and body["user"]["email"] == "cust@example.com" and body["staff"] is None
        assert anon.get("/api/v1/account/").status_code == 200
        user.refresh_from_db()
        assert user.last_login is not None

    def test_failure_message_does_not_reveal_whether_email_exists(self, anon):
        make_user("known@example.com")
        wrong_pw = anon.post(
            "/api/v1/auth/login/", {"email": "known@example.com", "password": "nope-nope-1"}, format="json"
        )
        no_user = anon.post(
            "/api/v1/auth/login/", {"email": "ghost@example.com", "password": "nope-nope-1"}, format="json"
        )
        assert wrong_pw.status_code == no_user.status_code == 400
        a, b = wrong_pw.json()["error"], no_user.json()["error"]
        assert a["code"] == b["code"] == "invalid_credentials"
        assert a["message"] == b["message"]
        assert anon.get("/api/v1/auth/me/").json()["authenticated"] is False

    def test_inactive_account_gets_restricted_message(self, anon):
        user = make_user("blocked@example.com")
        user.is_active = False
        user.restriction_reason = "chargebacks"
        user.save()
        res = anon.post(
            "/api/v1/auth/login/", {"email": "blocked@example.com", "password": "Str0ng-pass-123"}, format="json"
        )
        assert res.status_code == 403
        error = res.json()["error"]
        assert error["code"] == "account_restricted" and "restricted" in error["message"].lower()
        assert "chargebacks" not in res.content.decode()  # internal reason never shown to the customer

    def test_inactive_account_with_wrong_password_stays_generic(self, anon):
        user = make_user("blocked2@example.com")
        user.is_active = False
        user.save()
        res = anon.post(
            "/api/v1/auth/login/", {"email": "blocked2@example.com", "password": "wrong-wrong-1"}, format="json"
        )
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_credentials"

    def test_failed_attempts_are_logged_without_password(self, anon, caplog):
        make_user("log@example.com")
        secret = "S3cret-never-log-me"
        with caplog.at_level("WARNING", logger="apps.accounts.services"):
            anon.post("/api/v1/auth/login/", {"email": "log@example.com", "password": secret}, format="json")
            anon.post("/api/v1/auth/login/", {"email": "none@example.com", "password": secret}, format="json")
        assert "login failed" in caplog.text
        assert secret not in caplog.text

    def test_session_key_rotates_on_login(self, anon):
        make_user("rot@example.com")
        session = anon.session
        session["x"] = 1
        session.save()
        anon.cookies[settings.SESSION_COOKIE_NAME] = session.session_key
        res = anon.post(
            "/api/v1/auth/login/", {"email": "rot@example.com", "password": "Str0ng-pass-123"}, format="json"
        )
        assert res.status_code == 200
        assert res.cookies[settings.SESSION_COOKIE_NAME].value != session.session_key

    def test_merges_guest_cart_and_survives_merge_failure(self, anon, monkeypatch):
        make_user("cart@example.com")
        module = types.ModuleType("apps.cart.services")

        def boom(request, user):
            raise RuntimeError("cart exploded")

        module.merge_guest_cart = boom
        monkeypatch.setitem(sys.modules, "apps.cart.services", module)
        res = anon.post(
            "/api/v1/auth/login/", {"email": "cart@example.com", "password": "Str0ng-pass-123"}, format="json"
        )
        assert res.status_code == 200  # a cart problem must never block signing in

    def test_login_calls_merge(self, anon, fake_cart):
        make_user("m@example.com")
        anon.post("/api/v1/auth/login/", {"email": "m@example.com", "password": "Str0ng-pass-123"}, format="json")
        assert len(fake_cart) == 1

    def test_throttled(self, anon, monkeypatch):
        monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "login", "3/min")
        body = {"email": "x@example.com", "password": "wrong-wrong-1"}
        codes = [anon.post("/api/v1/auth/login/", body, format="json").status_code for _ in range(4)]
        assert codes == [400, 400, 400, 429]
        err = anon.post("/api/v1/auth/login/", body, format="json").json()["error"]
        assert err["code"] == "throttled"

    def test_validation_errors(self, anon):
        res = anon.post("/api/v1/auth/login/", {"email": "not-an-email"}, format="json")
        assert res.status_code == 400 and set(res.json()["error"]["fields"]) == {"email", "password"}


class TestLogout:
    def test_logout_really_ends_the_server_session(self):
        user = make_user("out@example.com")
        client = APIClient()
        client.post("/api/v1/auth/login/", {"email": "out@example.com", "password": "Str0ng-pass-123"}, format="json")
        stolen_cookie = client.cookies[settings.SESSION_COOKIE_NAME].value
        assert client.get("/api/v1/account/").status_code == 200

        res = client.post("/api/v1/auth/logout/")
        assert res.status_code == 204
        assert client.get("/api/v1/auth/me/").json()["authenticated"] is False
        assert client.get("/api/v1/account/").status_code == 401

        # replaying the old cookie from a different client must not resurrect the session
        replay = APIClient()
        replay.cookies[settings.SESSION_COOKIE_NAME] = stolen_cookie
        assert replay.get("/api/v1/auth/me/").json()["authenticated"] is False
        assert replay.get("/api/v1/account/").status_code == 401
        assert replay.get("/api/v1/addresses/").status_code == 401
        assert user.pk

    def test_logout_when_anonymous_is_ok(self, anon):
        assert anon.post("/api/v1/auth/logout/").status_code == 204


class TestMe:
    def test_anonymous(self, anon):
        res = anon.get("/api/v1/auth/me/")
        assert res.status_code == 200
        assert res.json() == {"authenticated": False, "user": None, "staff": None, "unread_notifications": 0}
        assert "no-store" in res["Cache-Control"]

    def test_customer(self):
        user = make_user()
        body = client_for(user).get("/api/v1/auth/me/").json()
        assert body["authenticated"] is True and body["staff"] is None
        assert set(body["user"]) == {
            "id",
            "email",
            "first_name",
            "last_name",
            "phone",
            "marketing_opt_in",
            "email_verified",
        }
        assert body["user"]["email_verified"] is True  # factories create verified users unless unverified=True

    def test_global_staff_has_null_branch_ids(self):
        admin = make_staff("ADMIN")
        staff = client_for(admin).get("/api/v1/auth/me/").json()["staff"]
        assert staff["role"] == "ADMIN" and staff["role_label"] == "Admin" and staff["branch_ids"] is None
        assert "staff.manage" not in staff["capabilities"] and "settings.manage" in staff["capabilities"]

    def test_branch_scoped_staff(self):
        b1, b2 = make_branch(), make_branch()
        manager = make_staff("BRANCH_MANAGER", branches=[b2, b1])
        staff = client_for(manager).get("/api/v1/auth/me/").json()["staff"]
        assert staff["branch_ids"] == sorted([b1.pk, b2.pk])
        assert "orders.view" in staff["capabilities"] and "staff.manage" not in staff["capabilities"]

    def test_inactive_staff_is_anonymous(self):
        admin = make_staff("ADMIN")
        client = client_for(admin)
        admin.is_active = False
        admin.save()
        assert client.get("/api/v1/auth/me/").json()["authenticated"] is False


# ── password reset ───────────────────────────────────────────────────────────
def _extract_link(message) -> tuple[str, str]:
    match = re.search(r"/reset-password\?uid=([^&\s]+)&token=([^\s\"<]+)", message.body)
    assert match, message.body
    return match.group(1), match.group(2)


class TestPasswordReset:
    URL = "/api/v1/auth/password-reset/"

    def test_round_trip(self, anon):
        user = make_user("reset@example.com")
        res = anon.post(self.URL, {"email": "RESET@example.com"}, format="json")
        assert res.status_code == 202
        assert len(mail.outbox) == 1
        message = mail.outbox[0]
        assert message.to == ["reset@example.com"]
        uid, token = _extract_link(message)
        assert f"{settings.SITE_URL}/reset-password?uid={uid}&token={token}" in message.body

        done = anon.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "Brand-new-passw0rd"},
            format="json",
        )
        assert done.status_code == 200
        user.refresh_from_db()
        assert user.check_password("Brand-new-passw0rd")
        login = anon.post(
            "/api/v1/auth/login/", {"email": "reset@example.com", "password": "Brand-new-passw0rd"}, format="json"
        )
        assert login.status_code == 200
        old = APIClient().post(
            "/api/v1/auth/login/", {"email": "reset@example.com", "password": "Str0ng-pass-123"}, format="json"
        )
        assert old.status_code == 400

    def test_token_is_single_use(self, anon):
        make_user("once@example.com")
        anon.post(self.URL, {"email": "once@example.com"}, format="json")
        uid, token = _extract_link(mail.outbox[0])
        body = {"uid": uid, "token": token, "new_password": "Brand-new-passw0rd"}
        assert anon.post("/api/v1/auth/password-reset/confirm/", body, format="json").status_code == 200
        again = anon.post(
            "/api/v1/auth/password-reset/confirm/", {**body, "new_password": "Another-passw0rd9"}, format="json"
        )
        assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_token"

    def test_confirm_invalidates_other_sessions(self, anon):
        user = make_user("sess@example.com")
        other = client_for(user)
        assert other.get("/api/v1/account/").status_code == 200
        anon.post(self.URL, {"email": "sess@example.com"}, format="json")
        uid, token = _extract_link(mail.outbox[0])
        anon.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "Brand-new-passw0rd"},
            format="json",
        )
        assert other.get("/api/v1/account/").status_code == 401

    def test_unknown_email_gets_same_response_and_no_mail(self, anon):
        make_user("real@example.com")
        known = anon.post(self.URL, {"email": "real@example.com"}, format="json")
        mail.outbox.clear()
        unknown = anon.post(self.URL, {"email": "ghost@example.com"}, format="json")
        assert known.status_code == unknown.status_code == 202
        assert known.json() == unknown.json()
        assert mail.outbox == []

    def test_inactive_user_gets_no_mail(self, anon):
        user = make_user("inactive@example.com")
        user.is_active = False
        user.save()
        assert anon.post(self.URL, {"email": "inactive@example.com"}, format="json").status_code == 202
        assert mail.outbox == []

    def test_weak_new_password_rejected_and_token_kept(self, anon):
        make_user("weak@example.com")
        anon.post(self.URL, {"email": "weak@example.com"}, format="json")
        uid, token = _extract_link(mail.outbox[0])
        res = anon.post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "123"}, format="json"
        )
        assert res.status_code == 400 and "new_password" in res.json()["error"]["fields"]
        ok = anon.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "Brand-new-passw0rd"},
            format="json",
        )
        assert ok.status_code == 200

    @pytest.mark.parametrize("uid,token", [("!!", "x"), ("MQ", "bad-token"), ("", "x")])
    def test_garbage_links_rejected(self, anon, uid, token):
        make_user()
        res = anon.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "Brand-new-passw0rd"},
            format="json",
        )
        assert res.status_code == 400

    def test_deactivated_user_cannot_use_old_link(self, anon):
        user = make_user("later@example.com")
        anon.post(self.URL, {"email": "later@example.com"}, format="json")
        uid, token = _extract_link(mail.outbox[0])
        user.is_active = False
        user.save()
        res = anon.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "Brand-new-passw0rd"},
            format="json",
        )
        assert res.status_code == 400

    def test_email_is_branded_with_store_settings(self, anon):
        StoreSettings.load()
        StoreSettings.objects.filter(pk=1).update(brand_name="Moka <Roasters>", support_email="help@moka.test")
        user = make_user("brand@example.com", first_name="Ana")
        anon.post(self.URL, {"email": user.email}, format="json")
        message = mail.outbox[0]
        assert "Moka <Roasters>" in message.subject
        html, mime = message.alternatives[0]
        assert mime == "text/html"
        assert "Moka &lt;Roasters&gt;" in html and "<Roasters>" not in html  # escaped in HTML
        assert "help@moka.test" in html and "Hi Ana" in html and "<table" in html
        assert "Moka <Roasters>" in message.body and "help@moka.test" in message.body

    def test_request_is_throttled(self, anon, monkeypatch):
        monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "password_reset", "2/hour")
        codes = [anon.post(self.URL, {"email": "a@example.com"}, format="json").status_code for _ in range(3)]
        assert codes == [202, 202, 429]

    def test_broker_outage_does_not_change_response(self, anon, monkeypatch):
        make_user("broker@example.com")
        from apps.accounts import tasks

        def down(*a, **k):
            raise ConnectionError("redis down")

        monkeypatch.setattr(tasks.send_password_reset_email, "delay", down)
        assert anon.post(self.URL, {"email": "broker@example.com"}, format="json").status_code == 202


def test_audit_not_polluted_by_auth_flows(anon):
    make_user("quiet@example.com")
    anon.post("/api/v1/auth/login/", {"email": "quiet@example.com", "password": "Str0ng-pass-123"}, format="json")
    assert AuditLog.objects.count() == 0
