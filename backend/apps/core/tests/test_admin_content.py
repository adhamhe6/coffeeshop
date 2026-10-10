import io
import shutil
from datetime import timedelta

import pytest
from django.conf import settings as dj_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.permissions import ROLE_CAPABILITIES
from apps.core.models import (
    Announcement,
    AuditLog,
    ContentBlock,
    ContentPage,
    NewsletterSubscriber,
    SocialProfile,
    StoreSettings,
)
from apps.core.testing import client_for
from tests.factories import make_branch, make_staff, make_user

pytestmark = pytest.mark.django_db

ROLES = sorted(ROLE_CAPABILITIES)
A = "/api/v1/admin/"


@pytest.fixture(autouse=True)
def _media_cleanup():
    yield
    shutil.rmtree(dj_settings.MEDIA_ROOT, ignore_errors=True)


@pytest.fixture
def admin():
    return make_staff("ADMIN")


@pytest.fixture
def client(admin):
    return client_for(admin)


def image_upload(name="logo.png", fmt="PNG", size=(8, 8)):
    buf = io.BytesIO()
    Image.new("RGB", size, "#2B1D16").save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type=f"image/{fmt.lower()}")


# ── permission matrix: every role against every endpoint family ──────────────
FAMILIES = {
    "settings": ("settings.manage", "settings/"),
    "social": ("content.manage", "social/"),
    "pages": ("content.manage", "pages/"),
    "blocks": ("content.manage", "blocks/"),
    "announcements": ("content.manage", "announcements/"),
    "newsletter": ("content.manage", "newsletter/"),
    "audit": ("audit.view", "audit-logs/"),
}


class TestPermissionMatrix:
    @pytest.mark.parametrize("family", sorted(FAMILIES))
    @pytest.mark.parametrize("role", ROLES)
    def test_read(self, role, family):
        capability, path = FAMILIES[family]
        actor = make_staff(role, branches=[make_branch()])
        res = client_for(actor).get(A + path)
        assert res.status_code == (200 if capability in ROLE_CAPABILITIES[role] else 403), (role, family)

    @pytest.mark.parametrize("role", ROLES)
    def test_writes_denied_without_capability(self, role):
        actor = make_staff(role, branches=[make_branch()])
        client = client_for(actor)
        content_ok = "content.manage" in ROLE_CAPABILITIES[role]
        settings_ok = "settings.manage" in ROLE_CAPABILITIES[role]
        social = client.post(A + "social/", {"platform": "x", "url": "https://x.com/a"}, format="json")
        assert social.status_code == (201 if content_ok else 403)
        page = client.post(A + "pages/", {"slug": "p", "title": "P"}, format="json")
        assert page.status_code == (201 if content_ok else 403)
        patch = client.patch(A + "settings/", {"tagline": "New"}, format="json")
        assert patch.status_code == (200 if settings_ok else 403)

    @pytest.mark.parametrize("path", [f[1] for f in FAMILIES.values()])
    def test_anonymous_401_and_customer_403(self, path):
        assert APIClient().get(A + path).status_code == 401
        assert client_for(make_user()).get(A + path).status_code == 403


# ── settings ─────────────────────────────────────────────────────────────────
class TestSettings:
    URL = A + "settings/"

    def test_get_shape(self, client):
        body = client.get(self.URL).json()
        assert {
            "brand_name",
            "currency",
            "tax_rate",
            "ordering_enabled",
            "allowed_checkout_methods",
            "logo_url",
        } <= set(body)
        assert body["logo_url"] is None and "logo" not in body and set(body["available_checkout_methods"]) >= {"cash"}

    def test_patch_updates_audits_and_invalidates_public_cache(self, client, admin):
        public = APIClient()
        assert public.get("/api/v1/store/").json()["brand_name"] == "Lantern Coffee Roasters"
        res = client.patch(
            self.URL,
            {
                "brand_name": "Moka",
                "tax_rate": "8.25",
                "currency": "eur",
                "ordering_enabled": False,
                "tax_label": "VAT",
            },
            format="json",
        )
        assert res.status_code == 200
        assert res.json()["currency"] == "EUR" and res.json()["tax_rate"] == "8.25"
        pub = public.get("/api/v1/store/").json()
        assert pub["brand_name"] == "Moka" and pub["ordering_enabled"] is False and pub["tax_label"] == "VAT"
        entry = AuditLog.objects.get(action="settings.update")
        assert entry.actor_id == admin.pk
        assert entry.changes["brand_name"] == {"from": "Lantern Coffee Roasters", "to": "Moka"}
        assert entry.changes["currency"] == {"from": "USD", "to": "EUR"}

    def test_noop_patch_writes_no_audit(self, client):
        client.patch(self.URL, {"tagline": StoreSettings.load().tagline}, format="json")
        assert not AuditLog.objects.filter(action="settings.update").exists()

    @pytest.mark.parametrize(
        "field,value",
        [
            ("tax_rate", "101"),
            ("tax_rate", "-1"),
            ("tax_rate", "abc"),
            ("currency", "US"),
            ("currency", "USDX"),
            ("currency", "U$D"),
            ("currency", "12A"),
            ("support_email", "nope"),
            ("support_phone", "call me maybe"),
            ("brand_name", ""),
            ("allowed_checkout_methods", ["bitcoin"]),
        ],
    )
    def test_validation(self, client, field, value):
        res = client.patch(self.URL, {field: value}, format="json")
        assert res.status_code == 400 and field in res.json()["error"]["fields"]
        assert not AuditLog.objects.filter(action="settings.update").exists()

    def test_checkout_methods_subset_dedupes(self, client):
        res = client.patch(self.URL, {"allowed_checkout_methods": ["cash", "cash", "demo"]}, format="json")
        assert res.status_code == 200 and res.json()["allowed_checkout_methods"] == ["cash", "demo"]

    def test_logo_upload_replace_and_remove(self, client):
        res = client.patch(self.URL, {"logo": image_upload()}, format="multipart")
        assert res.status_code == 200
        url = res.json()["logo_url"]
        assert url.startswith("/media/brand/") and url.endswith(".png")
        assert client_for(None).get("/api/v1/store/").json()["logo"] == url
        entry = AuditLog.objects.filter(action="settings.update").latest("id")
        assert entry.changes["logo"] == "changed"
        removed = client.patch(self.URL, {"remove_logo": True}, format="json")
        assert removed.status_code == 200 and removed.json()["logo_url"] is None
        assert APIClient().get("/api/v1/store/").json()["logo"] is None

    @pytest.mark.parametrize(
        "upload",
        [
            SimpleUploadedFile("logo.png", b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>", "image/png"),
            SimpleUploadedFile("logo.png", b"not an image at all", "image/png"),
            SimpleUploadedFile("evil.php", b"<?php echo 1;", "image/png"),
        ],
    )
    def test_bad_logo_rejected(self, client, upload):
        res = client.patch(self.URL, {"logo": upload}, format="multipart")
        assert res.status_code == 400 and "logo" in res.json()["error"]["fields"]
        assert not StoreSettings.load().logo

    def test_gif_rejected_oversize_rejected(self, client, settings):
        gif = image_upload("a.gif", "GIF")
        assert client.patch(self.URL, {"logo": gif}, format="multipart").status_code == 400
        settings.MAX_IMAGE_UPLOAD_BYTES = 50
        assert client.patch(self.URL, {"logo": image_upload(size=(64, 64))}, format="multipart").status_code == 400

    def test_cannot_delete_or_replace_wholesale(self, client):
        assert client.delete(self.URL).status_code == 405
        assert client.post(self.URL, {}, format="json").status_code == 405


# ── social ───────────────────────────────────────────────────────────────────
class TestSocial:
    URL = A + "social/"

    def test_crud_audit_and_cache(self, client, admin):
        public = APIClient()
        assert public.get("/api/v1/store/").json()["social"] == []
        created = client.post(
            self.URL,
            {
                "platform": "instagram",
                "url": "https://instagram.com/lantern",
                "handle": "@lantern",
                "is_placeholder": True,
            },
            format="json",
        )
        assert created.status_code == 201
        pk = created.json()["id"]
        assert public.get("/api/v1/store/").json()["social"][0]["platform"] == "instagram"
        upd = client.patch(f"{self.URL}{pk}/", {"is_active": False}, format="json")
        assert upd.status_code == 200
        assert public.get("/api/v1/store/").json()["social"] == []
        assert client.delete(f"{self.URL}{pk}/").status_code == 204
        actions = list(AuditLog.objects.filter(resource_id=str(pk)).order_by("id").values_list("action", flat=True))
        assert actions == ["social.create", "social.update", "social.delete"]
        update_entry = AuditLog.objects.get(action="social.update")
        assert update_entry.changes == {"is_active": {"from": True, "to": False}} and update_entry.actor_id == admin.pk

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "ftp://example.com",
            "data:text/html,hi",
            "//evil.com",
            "instagram.com/x",
            "mailto:a@b.c",
        ],
    )
    def test_only_http_https(self, client, url):
        res = client.post(self.URL, {"platform": "tiktok", "url": url}, format="json")
        assert res.status_code == 400 and "url" in res.json()["error"]["fields"]
        assert SocialProfile.objects.count() == 0

    def test_unique_platform(self, client):
        client.post(self.URL, {"platform": "x", "url": "https://x.com/a"}, format="json")
        dup = client.post(self.URL, {"platform": "x", "url": "https://x.com/b"}, format="json")
        assert dup.status_code == 400 and "platform" in dup.json()["error"]["fields"]

    def test_unknown_platform_rejected(self, client):
        assert (
            client.post(self.URL, {"platform": "myspace", "url": "https://x.com/a"}, format="json").status_code == 400
        )

    def test_update_to_unsafe_url_rejected(self, client):
        pk = client.post(self.URL, {"platform": "x", "url": "https://x.com/a"}, format="json").json()["id"]
        assert client.patch(f"{self.URL}{pk}/", {"url": "javascript:alert(1)"}, format="json").status_code == 400
        assert SocialProfile.objects.get(pk=pk).url == "https://x.com/a"


# ── pages ────────────────────────────────────────────────────────────────────
class TestPages:
    URL = A + "pages/"

    def test_crud_flow_with_public_cache_and_audit(self, client):
        public = APIClient()
        created = client.post(self.URL, {"slug": "about", "title": "About", "body_markdown": "# v1"}, format="json")
        assert created.status_code == 201
        pk = created.json()["id"]
        assert public.get("/api/v1/content/pages/about/").json()["body_markdown"] == "# v1"
        client.patch(f"{self.URL}{pk}/", {"body_markdown": "# v2", "title": "About us"}, format="json")
        assert public.get("/api/v1/content/pages/about/").json()["body_markdown"] == "# v2"
        client.patch(f"{self.URL}{pk}/", {"is_published": False}, format="json")
        assert public.get("/api/v1/content/pages/about/").status_code == 404
        listing = client.get(self.URL, {"search": "about", "is_published": "false"}).json()
        assert listing["count"] == 1
        update_entries = AuditLog.objects.filter(action="content_page.update").order_by("id")
        first = update_entries[0].changes
        assert first["body_markdown"] == "changed" and first["title"] == {"from": "About", "to": "About us"}
        assert client.delete(f"{self.URL}{pk}/").status_code == 204
        assert AuditLog.objects.filter(action="content_page.delete").count() == 1

    def test_body_limit_is_50k(self, client):
        ok = client.post(self.URL, {"slug": "big", "title": "Big", "body_markdown": "x" * 50_000}, format="json")
        assert ok.status_code == 201
        too_big = client.post(
            self.URL, {"slug": "bigger", "title": "Big", "body_markdown": "x" * 50_001}, format="json"
        )
        assert too_big.status_code == 400 and "body_markdown" in too_big.json()["error"]["fields"]

    @pytest.mark.parametrize("slug", ["Has Space", "weird/slash", "ümlaut", "", "a" * 60])
    def test_slug_validation(self, client, slug):
        res = client.post(self.URL, {"slug": slug, "title": "T"}, format="json")
        assert res.status_code == 400 and "slug" in res.json()["error"]["fields"]

    def test_slug_unique(self, client):
        ContentPage.objects.create(slug="faq", title="FAQ")
        res = client.post(self.URL, {"slug": "faq", "title": "Again"}, format="json")
        assert res.status_code == 400 and "slug" in res.json()["error"]["fields"]

    def test_title_required(self, client):
        assert client.post(self.URL, {"slug": "notitle"}, format="json").status_code == 400


# ── blocks ───────────────────────────────────────────────────────────────────
class TestBlocks:
    URL = A + "blocks/"

    def test_create_update_by_key(self, client):
        public = APIClient()
        created = client.post(
            self.URL, {"key": "home-hero", "title": "Welcome", "cta_label": "Order", "cta_url": "/menu"}, format="json"
        )
        assert created.status_code == 201
        assert public.get("/api/v1/content/blocks/").json()["home-hero"]["title"] == "Welcome"
        upd = client.patch(
            f"{self.URL}home-hero/", {"title": "Hello", "cta_url": "https://example.com/x"}, format="json"
        )
        assert upd.status_code == 200 and upd.json()["title"] == "Hello"
        assert public.get("/api/v1/content/blocks/").json()["home-hero"]["cta_url"] == "https://example.com/x"
        assert client.get(f"{self.URL}home-hero/").status_code == 200
        client.patch(f"{self.URL}home-hero/", {"is_active": False}, format="json")
        assert public.get("/api/v1/content/blocks/").json() == {}

    def test_dotted_keys_such_as_the_seeded_home_blocks_are_addressable(self, client):
        ContentBlock.objects.create(key="home.story", title="Old")
        res = client.patch(f"{self.URL}home.story/", {"title": "New"}, format="json")
        assert res.status_code == 200 and res.json()["title"] == "New"
        assert client.get(f"{self.URL}home.story/").status_code == 200

    @pytest.mark.parametrize("cta", ["javascript:alert(1)", "//evil.example", "data:text/html,x", "menu", "ftp://x.y"])
    def test_cta_url_must_be_safe_link(self, client, cta):
        res = client.post(self.URL, {"key": "bad", "cta_url": cta}, format="json")
        assert res.status_code == 400 and "cta_url" in res.json()["error"]["fields"]
        assert ContentBlock.objects.count() == 0
        ContentBlock.objects.create(key="ok", cta_url="/menu")
        assert client.patch(f"{self.URL}ok/", {"cta_url": cta}, format="json").status_code == 400

    def test_key_is_immutable_and_unique_and_blocks_cannot_be_deleted(self, client):
        client.post(self.URL, {"key": "k1", "title": "A"}, format="json")
        assert client.post(self.URL, {"key": "k1", "title": "B"}, format="json").status_code == 400
        assert client.patch(f"{self.URL}k1/", {"key": "k2"}, format="json").status_code == 400
        assert client.delete(f"{self.URL}k1/").status_code == 405
        assert ContentBlock.objects.filter(key="k1").exists()

    def test_unknown_key_404(self, client):
        assert client.patch(f"{self.URL}nope/", {"title": "x"}, format="json").status_code == 404

    def test_image_upload(self, client):
        client.post(self.URL, {"key": "img", "title": "T"}, format="json")
        res = client.patch(f"{self.URL}img/", {"image": image_upload("h.png")}, format="multipart")
        assert res.status_code == 200 and res.json()["image_url"].startswith("/media/content/")
        assert APIClient().get("/api/v1/content/blocks/").json()["img"]["image"] == res.json()["image_url"]
        bad = client.patch(
            f"{self.URL}img/", {"image": SimpleUploadedFile("x.png", b"nope", "image/png")}, format="multipart"
        )
        assert bad.status_code == 400
        gone = client.patch(f"{self.URL}img/", {"remove_image": True}, format="json")
        assert gone.json()["image_url"] is None

    def test_audited_with_long_text_not_stored(self, client):
        client.post(self.URL, {"key": "story", "body": "old"}, format="json")
        client.patch(f"{self.URL}story/", {"body": "a very long new story"}, format="json")
        entry = AuditLog.objects.get(action="content_block.update")
        assert entry.changes == {"body": "changed"}


# ── announcements ────────────────────────────────────────────────────────────
class TestAnnouncements:
    URL = A + "announcements/"

    def test_crud_and_public_visibility(self, client):
        public = APIClient()
        created = client.post(self.URL, {"message": "Closed Monday", "link_url": "/locations"}, format="json")
        assert created.status_code == 201
        assert public.get("/api/v1/store/").json()["announcement"]["message"] == "Closed Monday"
        pk = created.json()["id"]
        client.patch(f"{self.URL}{pk}/", {"is_active": False}, format="json")
        assert public.get("/api/v1/store/").json()["announcement"] is None
        assert client.delete(f"{self.URL}{pk}/").status_code == 204
        assert Announcement.objects.count() == 0
        assert AuditLog.objects.filter(action__startswith="announcement.").count() == 3

    def test_validation(self, client):
        now = timezone.now()
        long = client.post(self.URL, {"message": "x" * 201}, format="json")
        assert long.status_code == 400 and "message" in long.json()["error"]["fields"]
        bad_link = client.post(self.URL, {"message": "m", "link_url": "javascript:alert(1)"}, format="json")
        assert bad_link.status_code == 400 and "link_url" in bad_link.json()["error"]["fields"]
        window = client.post(
            self.URL,
            {"message": "m", "starts_at": now.isoformat(), "ends_at": (now - timedelta(hours=1)).isoformat()},
            format="json",
        )
        assert window.status_code == 400 and "ends_at" in window.json()["error"]["fields"]
        assert Announcement.objects.count() == 0

    def test_update_window_validated_against_stored_value(self, client):
        now = timezone.now()
        pk = client.post(
            self.URL,
            {"message": "m", "starts_at": now.isoformat(), "ends_at": (now + timedelta(days=1)).isoformat()},
            format="json",
        ).json()["id"]
        res = client.patch(f"{self.URL}{pk}/", {"ends_at": (now - timedelta(days=1)).isoformat()}, format="json")
        assert res.status_code == 400


# ── newsletter ───────────────────────────────────────────────────────────────
class TestNewsletterAdmin:
    URL = A + "newsletter/"

    def test_list_search_filter(self, client):
        NewsletterSubscriber.objects.create(email="a@example.com")
        NewsletterSubscriber.objects.create(email="b@example.com", is_active=False)
        body = client.get(self.URL).json()
        assert body["count"] == 2 and set(body["results"][0]) == {"id", "email", "is_active", "created_at"}
        assert client.get(self.URL, {"is_active": "false"}).json()["count"] == 1
        assert client.get(self.URL, {"search": "a@"}).json()["count"] == 1

    def test_csv_export_is_injection_safe_and_audited(self, client, admin):
        NewsletterSubscriber.objects.create(email="=cmd|' /C calc'!A0@example.com")
        NewsletterSubscriber.objects.create(email="+1@example.com")
        NewsletterSubscriber.objects.create(email="@sum@example.com", is_active=False)
        NewsletterSubscriber.objects.create(email="normal@example.com")
        res = client.get(self.URL, {"format": "csv"})
        assert res.status_code == 200
        assert res["Content-Type"].startswith("text/csv")
        assert "attachment" in res["Content-Disposition"]
        text = b"".join(res.streaming_content).decode("utf-8-sig")
        lines = text.strip().splitlines()
        assert lines[0] == "email,active,subscribed_at"
        emails = {line.split(",")[0] for line in lines[1:]}
        assert emails == {
            "'=cmd|' /C calc'!A0@example.com",
            "'+1@example.com",
            "'@sum@example.com",
            "normal@example.com",
        }
        assert not any(e.startswith(("=", "+", "-", "@")) for e in emails)
        entry = AuditLog.objects.get(action="newsletter.export")
        assert entry.actor_id == admin.pk and "4" in entry.summary

    def test_csv_respects_filters(self, client):
        NewsletterSubscriber.objects.create(email="on@example.com")
        NewsletterSubscriber.objects.create(email="off@example.com", is_active=False)
        res = client.get(self.URL, {"format": "csv", "is_active": "true"})
        text = b"".join(res.streaming_content).decode("utf-8-sig")
        assert "on@example.com" in text and "off@example.com" not in text

    def test_csv_requires_permission(self):
        support = make_staff("SUPPORT_AGENT")
        assert client_for(support).get(self.URL, {"format": "csv"}).status_code == 403
        assert APIClient().get(self.URL, {"format": "csv"}).status_code == 401
        assert not AuditLog.objects.filter(action="newsletter.export").exists()

    def test_read_only(self, client):
        assert client.post(self.URL, {"email": "x@example.com"}, format="json").status_code == 405
