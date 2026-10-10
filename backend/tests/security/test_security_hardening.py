"""Regression tests for the findings of the independent security review (docs/security.md, S-numbers)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.core.testing import client_for
from tests.factories import make_branch, make_product, make_user

pytestmark = pytest.mark.django_db

BACKEND_DIR = Path(__file__).resolve().parents[2]


def csrf_client() -> APIClient:
    """A client that enforces CSRF and has fetched its cookie, like the SPA."""
    client = APIClient(enforce_csrf_checks=True)
    client.get("/api/v1/auth/csrf/")
    client.credentials(HTTP_X_CSRFTOKEN=client.cookies["lantern_csrftoken"].value)
    return client


# ── S1: the Django admin login form must be rate limited ─────────────────────────────────────────────────────────────
class TestDjangoAdminLoginThrottle:
    def test_repeated_failed_admin_logins_are_throttled(self, monkeypatch):
        from apps.core import middleware

        monkeypatch.setitem(middleware.AdminLoginThrottle.THROTTLE_RATES, "admin_login", "3/min")
        monkeypatch.setitem(middleware.AdminLoginThrottle.THROTTLE_RATES, "admin_login_user", "100/min")
        cache.clear()
        client = APIClient()
        statuses = [
            client.post("/django-admin/login/", {"username": "root@example.com", "password": f"wrong-{i}"}).status_code
            for i in range(6)
        ]
        assert statuses[:3] == [200, 200, 200]
        assert set(statuses[3:]) == {429}

    def test_one_account_cannot_be_hammered_from_many_addresses(self, monkeypatch):
        from apps.core import middleware

        monkeypatch.setitem(middleware.AdminLoginThrottle.THROTTLE_RATES, "admin_login", "100/min")
        monkeypatch.setitem(middleware.AdminLoginThrottle.THROTTLE_RATES, "admin_login_user", "3/hour")
        cache.clear()
        client = APIClient()
        codes = []
        for i in range(6):
            r = client.post(
                "/django-admin/login/",
                {"username": "Root@Example.com", "password": f"wrong-{i}"},
                REMOTE_ADDR=f"203.0.113.{i + 1}",
            )
            codes.append(r.status_code)
        assert codes[:3] == [200, 200, 200] and set(codes[3:]) == {429}

    def test_get_of_the_login_page_is_not_throttled(self, monkeypatch):
        from apps.core import middleware

        monkeypatch.setitem(middleware.AdminLoginThrottle.THROTTLE_RATES, "admin_login", "1/min")
        client = APIClient()
        assert [client.get("/django-admin/login/").status_code for _ in range(4)] == [200] * 4


# ── S2/S3: hostile payloads must produce 4xx, never an unhandled 500 ─────────────────────────────────────────────────
class TestHostileRequestsAreClientErrors:
    def test_non_ascii_demo_signature_is_a_400(self):
        res = APIClient().post(
            "/api/v1/payments/webhooks/demo/",
            data=b"{}",
            content_type="application/json",
            HTTP_X_DEMO_SIGNATURE="café",
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "invalid_signature"

    def test_oversized_webhook_body_is_rejected_cleanly(self, settings):
        settings.DATA_UPLOAD_MAX_MEMORY_SIZE = 1024
        res = APIClient().post("/api/v1/payments/webhooks/stripe/", data=b"x" * 4096, content_type="application/json")
        assert res.status_code == 413
        assert res.json()["error"]["code"] == "payload_too_large"

    def test_oversized_json_body_on_a_public_endpoint_is_rejected_cleanly(self, settings):
        settings.DATA_UPLOAD_MAX_MEMORY_SIZE = 1024
        client = csrf_client()
        res = client.post(
            "/api/v1/auth/login/",
            data=json.dumps({"email": "a@example.com", "password": "x" * 4096}),
            content_type="application/json",
        )
        assert res.status_code == 413
        assert res.json()["error"]["code"] == "payload_too_large"

    def test_deeply_nested_json_is_a_400(self):
        client = csrf_client()
        res = client.post("/api/v1/auth/login/", data="[" * 50_000 + "]" * 50_000, content_type="application/json")
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "parse_error"


# ── S4: absurd numbers/dates in customer input are validation errors ─────────────────────────────────────────────────
class TestExtremeInputs:
    def test_huge_quantity_in_new_cart_line_is_a_400(self):
        product = make_product()
        res = client_for().post(
            "/api/v1/cart/items/", {"product_id": product.pk, "quantity": 10**30, "option_ids": []}, format="json"
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "invalid_quantity"

    def test_requested_for_outside_the_calendar_is_a_400_not_a_500(self):
        user = make_user()
        branch = make_branch(timezone="America/New_York")  # negative UTC offset: year 1 overflows on conversion
        product = make_product()
        client = client_for(user)
        assert (
            client.post("/api/v1/cart/items/", {"product_id": product.pk, "quantity": 1}, format="json").status_code
            == 201
        )
        for stamp in ("0001-01-01T00:00:00Z", "9999-12-31T23:59:59Z"):
            res = client.post(
                "/api/v1/cart/preview/",
                {"order_type": "PICKUP", "branch_id": branch.pk, "requested_for": stamp},
                format="json",
            )
            assert res.status_code < 500, stamp
            res = client.post(
                "/api/v1/checkout/",
                {
                    "branch_id": branch.pk,
                    "order_type": "PICKUP",
                    "payment_method": "cash",
                    "accept_terms": True,
                    "requested_for": stamp,
                },
                format="json",
                HTTP_IDEMPOTENCY_KEY=f"extreme-{stamp[:4]}-key",
            )
            assert res.status_code < 500, stamp


# ── S5: production settings refuse placeholder secrets and do not trust dev origins by default ───────────────────────
def _import_prod_settings(**env) -> subprocess.CompletedProcess:
    base_env = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "CORS_", "CSRF_"))}
    base_env.update({"DJANGO_SETTINGS_MODULE": "config.settings.prod", "DJANGO_ALLOWED_HOSTS": "shop.example.com"})
    base_env.update(env)
    code = (
        "import json; from django.conf import settings; "
        "print(json.dumps({'cors': settings.CORS_ALLOWED_ORIGINS, 'csrf': settings.CSRF_TRUSTED_ORIGINS}))"
    )
    return subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND_DIR, env=base_env, capture_output=True, text=True, timeout=60
    )


class TestProductionSettings:
    @pytest.mark.parametrize(
        "key",
        [
            "replace-me-with-a-long-random-value-before-any-real-deployment-0123456789",
            "change-me-" + "x" * 50,
            "insecure-dev-only-key-" + "x" * 50,
            "a" * 50,
            "short",
        ],
    )
    def test_placeholder_or_weak_secret_keys_are_refused(self, key):
        result = _import_prod_settings(DJANGO_SECRET_KEY=key)
        assert result.returncode != 0
        assert "DJANGO_SECRET_KEY" in result.stderr

    def test_strong_key_is_accepted_and_dev_origins_are_not_trusted(self):
        result = _import_prod_settings(DJANGO_SECRET_KEY="k9Zq-W3vXr8T_mL2pQa7Yb5Nc1Hd6Fs0JgUe4Ro" * 2)
        assert result.returncode == 0, result.stderr
        origins = json.loads(result.stdout.strip().splitlines()[-1])
        assert origins["cors"] == [] and origins["csrf"] == []


# ── S6: anonymous cart creation must be rate limited (each call otherwise creates a persistent Cart row) ─────────────
class TestGuestCartCreationThrottle:
    def test_creating_guest_carts_in_bulk_is_throttled_but_adding_to_your_own_is_not(self, monkeypatch):
        from apps.cart.models import Cart
        from apps.cart.views import GuestCartCreateThrottle

        monkeypatch.setitem(GuestCartCreateThrottle.THROTTLE_RATES, "cart_create", "3/hour")
        cache.clear()
        product = make_product()
        body = {"product_id": product.pk, "quantity": 1}
        attacker = APIClient()
        codes = []
        for _ in range(5):
            attacker.cookies.clear()  # a bot never keeps the guest-cart cookie
            codes.append(attacker.post("/api/v1/cart/items/", body, format="json").status_code)
        assert codes == [201, 201, 201, 429, 429]
        assert Cart.objects.filter(user__isnull=True).count() == 3

        shopper = APIClient()  # a real browser keeps its cookie: only the first call creates a cart
        other_ip = {"REMOTE_ADDR": "198.51.100.9"}
        assert shopper.post("/api/v1/cart/items/", body, format="json", **other_ip).status_code == 201
        for _ in range(5):
            assert shopper.post("/api/v1/cart/items/", body, format="json", **other_ip).status_code == 201

    def test_signed_in_customers_are_not_affected(self, monkeypatch):
        from apps.cart.views import GuestCartCreateThrottle

        monkeypatch.setitem(GuestCartCreateThrottle.THROTTLE_RATES, "cart_create", "1/hour")
        client = client_for(make_user())
        product = make_product()
        for _ in range(3):
            assert client.post("/api/v1/cart/items/", {"product_id": product.pk}, format="json").status_code == 201


# ── S7: personal API responses must not be stored by browsers/proxies ───────────────────────────────────────────────────
class TestPersonalResponsesAreNotCacheable:
    @pytest.mark.parametrize(
        "path", ["/api/v1/orders/", "/api/v1/addresses/", "/api/v1/notifications/", "/api/v1/cart/"]
    )
    def test_signed_in_api_responses_are_no_store(self, path):
        res = client_for(make_user()).get(path)
        assert res.status_code == 200
        assert "no-store" in res["Cache-Control"]

    def test_public_cacheable_responses_keep_their_own_policy(self):
        res = client_for(make_user()).get("/api/v1/store/")
        assert "max-age=30" in res["Cache-Control"]
