import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.testing import client_for
from tests.factories import make_user

pytestmark = pytest.mark.django_db

PASSWORD = "Str0ng-pass-123"


class TestProfile:
    def test_anonymous_gets_401(self):
        for method, url in [
            ("get", "/api/v1/account/"),
            ("patch", "/api/v1/account/"),
            ("post", "/api/v1/account/password/"),
        ]:
            res = getattr(APIClient(), method)(url)
            assert res.status_code == 401
            assert res.json()["error"]["code"] == "not_authenticated"

    def test_get(self):
        user = make_user("p@example.com", phone="+15550100")
        body = client_for(user).get("/api/v1/account/").json()
        assert body["email"] == "p@example.com" and body["phone"] == "+15550100"
        assert "password" not in body and "is_staff" not in body

    def test_patch_profile(self):
        user = make_user()
        res = client_for(user).patch(
            "/api/v1/account/",
            {"first_name": "Ada", "last_name": "Lovelace", "phone": "+44 20 7946 0958", "marketing_opt_in": True},
            format="json",
        )
        assert res.status_code == 200
        user.refresh_from_db()
        assert (user.first_name, user.last_name, user.phone, user.marketing_opt_in) == (
            "Ada",
            "Lovelace",
            "+44 20 7946 0958",
            True,
        )

    def test_invalid_phone_rejected(self):
        res = client_for(make_user()).patch("/api/v1/account/", {"phone": "call me"}, format="json")
        assert res.status_code == 400 and "phone" in res.json()["error"]["fields"]

    def test_cannot_escalate_privileges(self):
        user = make_user()
        res = client_for(user).patch(
            "/api/v1/account/", {"is_staff": True, "is_superuser": True, "is_active": False, "id": 999}, format="json"
        )
        assert res.status_code == 200
        user.refresh_from_db()
        assert not user.is_staff and not user.is_superuser and user.is_active

    def test_email_change_requires_current_password(self):
        user = make_user("old@example.com")
        client = client_for(user)
        missing = client.patch("/api/v1/account/", {"email": "new@example.com"}, format="json")
        assert missing.status_code == 400 and "current_password" in missing.json()["error"]["fields"]
        wrong = client.patch(
            "/api/v1/account/", {"email": "new@example.com", "current_password": "nope"}, format="json"
        )
        assert wrong.status_code == 400 and "current_password" in wrong.json()["error"]["fields"]
        user.refresh_from_db()
        assert user.email == "old@example.com"

    def test_email_change_success_normalises_case(self):
        user = make_user("old@example.com")
        res = client_for(user).patch(
            "/api/v1/account/", {"email": "New.Address@Example.com", "current_password": PASSWORD}, format="json"
        )
        assert res.status_code == 200 and res.json()["email"] == "new.address@example.com"
        user.refresh_from_db()
        assert user.email == "new.address@example.com"

    def test_email_change_uniqueness_case_insensitive(self):
        make_user("taken@example.com")
        user = make_user("me@example.com")
        res = client_for(user).patch(
            "/api/v1/account/", {"email": "TAKEN@example.com", "current_password": PASSWORD}, format="json"
        )
        assert res.status_code == 400 and "email" in res.json()["error"]["fields"]

    def test_same_email_is_a_noop(self):
        user = make_user("same@example.com")
        res = client_for(user).patch(
            "/api/v1/account/", {"email": "SAME@example.com", "first_name": "Z"}, format="json"
        )
        assert res.status_code == 200
        user.refresh_from_db()
        assert user.first_name == "Z"


class TestPasswordChange:
    URL = "/api/v1/account/password/"

    def test_success_keeps_current_session_and_drops_others(self):
        user = make_user()
        client, other = client_for(user), client_for(user)
        res = client.post(
            self.URL, {"current_password": PASSWORD, "new_password": "Even-better-pass-77"}, format="json"
        )
        assert res.status_code == 204
        assert client.get("/api/v1/account/").status_code == 200  # still signed in
        assert other.get("/api/v1/account/").status_code == 401  # everything else is signed out
        user.refresh_from_db()
        assert user.check_password("Even-better-pass-77")
        fresh = APIClient()
        assert (
            fresh.post("/api/v1/auth/login/", {"email": user.email, "password": PASSWORD}, format="json").status_code
            == 400
        )

    def test_wrong_current_password(self):
        user = make_user()
        res = client_for(user).post(
            self.URL, {"current_password": "bad", "new_password": "Even-better-pass-77"}, format="json"
        )
        assert res.status_code == 400 and "current_password" in res.json()["error"]["fields"]
        user.refresh_from_db()
        assert user.check_password(PASSWORD)

    def test_weak_new_password(self):
        res = client_for(make_user()).post(
            self.URL, {"current_password": PASSWORD, "new_password": "12345"}, format="json"
        )
        assert res.status_code == 400 and "new_password" in res.json()["error"]["fields"]

    def test_same_password_rejected(self):
        res = client_for(make_user()).post(
            self.URL, {"current_password": PASSWORD, "new_password": PASSWORD}, format="json"
        )
        assert res.status_code == 400 and "new_password" in res.json()["error"]["fields"]

    def test_password_not_stored_in_plain_text(self):
        user = make_user()
        client_for(user).post(
            self.URL, {"current_password": PASSWORD, "new_password": "Even-better-pass-77"}, format="json"
        )
        assert "Even-better" not in User.objects.get(pk=user.pk).password
