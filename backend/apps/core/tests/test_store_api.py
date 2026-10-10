from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from apps.core.cache import bump
from apps.core.models import Announcement, ContentBlock, ContentPage, NewsletterSubscriber, SocialProfile, StoreSettings

pytestmark = pytest.mark.django_db

STORE = "/api/v1/store/"


@pytest.fixture
def anon():
    return APIClient()


class TestStore:
    def test_public_payload(self, anon):
        StoreSettings.objects.update_or_create(
            pk=1,
            defaults={
                "brand_name": "Moka Roasters",
                "tagline": "Hot and dark",
                "currency": "EUR",
                "tax_rate": "7.50",
                "tax_label": "VAT",
                "prices_include_tax": True,
                "ordering_enabled": False,
                "enable_reviews": False,
            },
        )
        res = anon.get(STORE)
        assert res.status_code == 200
        body = res.json()
        assert body["brand_name"] == "Moka Roasters" and body["currency"] == "EUR"
        assert body["tax_rate"] == "7.50" and body["tax_label"] == "VAT" and body["prices_include_tax"] is True
        assert body["ordering_enabled"] is False and body["enable_reviews"] is False
        assert body["logo"] is None and body["announcement"] is None and body["social"] == []
        assert set(body["checkout_methods"]) <= {"demo", "cash", "stripe"} and body["checkout_methods"]
        assert {"support_email", "support_phone", "business_address", "tagline"} <= set(body)
        # nothing internal leaks
        assert "auto_confirm_paid_orders" not in body and "legal_name" not in body and "id" not in body

    def test_anonymous_access_with_no_session_touch(self, anon):
        res = anon.get(STORE)
        assert res.status_code == 200 and "lantern_sessionid" not in res.cookies

    def test_logo_is_root_relative(self, anon):
        store = StoreSettings.load()
        store.logo = "brand/logo.png"
        store.save()
        assert anon.get(STORE).json()["logo"] == "/media/brand/logo.png"

    def test_social_active_only_with_placeholder_flag(self, anon):
        SocialProfile.objects.create(
            platform="instagram", url="https://instagram.com/lantern", handle="@lantern", is_placeholder=True
        )
        SocialProfile.objects.create(platform="tiktok", url="https://tiktok.com/@lantern", is_active=False)
        SocialProfile.objects.create(platform="x", url="https://x.com/lantern", sort_order=5)
        social = anon.get(STORE).json()["social"]
        assert [s["platform"] for s in social] == ["instagram", "x"]
        assert social[0] == {
            "platform": "instagram",
            "url": "https://instagram.com/lantern",
            "handle": "@lantern",
            "is_placeholder": True,
        }

    def test_current_announcement_only(self, anon):
        now = timezone.now()
        Announcement.objects.create(
            message="expired", ends_at=now - timedelta(days=1), starts_at=now - timedelta(days=3)
        )
        Announcement.objects.create(message="future", starts_at=now + timedelta(days=1))
        Announcement.objects.create(message="off", is_active=False)
        live = Announcement.objects.create(message="Free pastry today", link_url="/menu")
        body = anon.get(STORE).json()
        assert body["announcement"] == {"id": live.pk, "message": "Free pastry today", "link_url": "/menu"}

    def test_cached_then_invalidated_by_bump(self, anon, django_assert_num_queries):
        anon.get(STORE)
        with django_assert_num_queries(0):
            anon.get(STORE)
        StoreSettings.objects.filter(pk=1).update(brand_name="Changed Behind Cache")
        assert anon.get(STORE).json()["brand_name"] != "Changed Behind Cache"
        bump("settings")
        assert anon.get(STORE).json()["brand_name"] == "Changed Behind Cache"

    def test_checkout_methods_follow_owner_selection(self, anon):
        StoreSettings.objects.update_or_create(pk=1, defaults={"allowed_checkout_methods": ["cash", "nonexistent"]})
        assert anon.get(STORE).json()["checkout_methods"] == ["cash"]

    def test_write_methods_not_allowed(self, anon):
        assert anon.post(STORE, {}, format="json").status_code in (401, 403, 405)


class TestContent:
    def test_published_page(self, anon):
        ContentPage.objects.create(
            slug="about", title="About us", summary="Who we are", body_markdown="# Hello\n\nWorld"
        )
        res = anon.get("/api/v1/content/pages/about/")
        assert res.status_code == 200
        body = res.json()
        assert body["slug"] == "about" and body["title"] == "About us" and body["body_markdown"].startswith("# Hello")
        assert set(body) == {"slug", "title", "summary", "body_markdown", "updated_at"}

    def test_unpublished_and_unknown_are_404(self, anon):
        ContentPage.objects.create(slug="draft", title="Draft", is_published=False)
        for slug in ("draft", "nope"):
            res = anon.get(f"/api/v1/content/pages/{slug}/")
            assert res.status_code == 404 and res.json()["error"]["code"] == "not_found"

    def test_blocks_keyed_by_key_active_only(self, anon):
        ContentBlock.objects.create(
            key="home-hero", title="Hero", eyebrow="New", cta_label="Order", cta_url="/menu", image="content/h.webp"
        )
        ContentBlock.objects.create(key="home-story", title="Story", body="Body")
        ContentBlock.objects.create(key="hidden", title="Hidden", is_active=False)
        body = anon.get("/api/v1/content/blocks/").json()
        assert set(body) == {"home-hero", "home-story"}
        hero = body["home-hero"]
        assert hero["key"] == "home-hero" and hero["image"] == "/media/content/h.webp" and hero["cta_url"] == "/menu"
        assert body["home-story"]["image"] is None

    def test_content_is_cached_until_bump(self, anon):
        page = ContentPage.objects.create(slug="faq", title="FAQ v1")
        assert anon.get("/api/v1/content/pages/faq/").json()["title"] == "FAQ v1"
        ContentPage.objects.filter(pk=page.pk).update(title="FAQ v2")
        assert anon.get("/api/v1/content/pages/faq/").json()["title"] == "FAQ v1"
        bump("settings")
        assert anon.get("/api/v1/content/pages/faq/").json()["title"] == "FAQ v2"


class TestNewsletter:
    URL = "/api/v1/newsletter/subscribe/"

    def test_subscribe_and_is_idempotent(self, anon):
        first = anon.post(self.URL, {"email": "Fan@Example.com"}, format="json")
        second = anon.post(self.URL, {"email": "fan@example.COM"}, format="json")
        assert first.status_code == second.status_code == 202
        assert first.json() == second.json()  # existing and new addresses are indistinguishable
        assert NewsletterSubscriber.objects.filter(email="fan@example.com").count() == 1
        assert NewsletterSubscriber.objects.count() == 1

    def test_resubscribing_reactivates(self, anon):
        NewsletterSubscriber.objects.create(email="back@example.com", is_active=False)
        anon.post(self.URL, {"email": "back@example.com"}, format="json")
        assert NewsletterSubscriber.objects.get(email="back@example.com").is_active

    @pytest.mark.parametrize("body", [{}, {"email": ""}, {"email": "not-an-email"}, {"email": "a" * 300 + "@x.com"}])
    def test_invalid(self, anon, body):
        res = anon.post(self.URL, body, format="json")
        assert res.status_code == 400 and "email" in res.json()["error"]["fields"]
        assert NewsletterSubscriber.objects.count() == 0

    def test_throttled(self, anon, monkeypatch):
        monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "newsletter", "2/hour")
        codes = [anon.post(self.URL, {"email": f"x{i}@example.com"}, format="json").status_code for i in range(3)]
        assert codes == [202, 202, 429]
        assert NewsletterSubscriber.objects.count() == 2
