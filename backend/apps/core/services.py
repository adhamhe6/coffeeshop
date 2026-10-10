"""Storefront-facing reads (cached) and cache invalidation for settings/content."""

from __future__ import annotations

from django.conf import settings
from django.db.models.fields.files import FieldFile

from .cache import bump, cached
from .models import Announcement, ContentBlock, ContentPage, SocialProfile, StoreSettings


def media_url(file: FieldFile | None) -> str | None:
    """Root-relative URL for an uploaded file (cross-cutting rule 12), or None when no file is set."""
    if not file:
        return None
    url = file.url
    if "://" in url:  # absolute storage URL: keep only the path so it works behind any host
        from urllib.parse import urlparse

        url = urlparse(url).path or url
    return url


def bump_settings_caches() -> None:
    """Settings/content writes invalidate both the settings namespace and catalog (prices, currency, sitemap)."""
    bump("settings")
    bump("catalog")


def checkout_method_keys(store: StoreSettings) -> list[str]:
    """Payment provider keys offered at checkout: the owner's selection limited to what is enabled in this deployment."""
    try:
        from apps.payments.registry import enabled_provider_keys

        enabled = list(enabled_provider_keys())
    except Exception:
        enabled = list(settings.PAYMENT_PROVIDERS_ENABLED)
    chosen = [k for k in (store.allowed_checkout_methods or []) if k in enabled]
    return chosen or enabled


def available_provider_keys() -> list[str]:
    try:
        from apps.payments.registry import enabled_provider_keys

        return list(enabled_provider_keys())
    except Exception:
        return list(settings.PAYMENT_PROVIDERS_ENABLED)


def _build_store_payload() -> dict:
    store = StoreSettings.load()
    announcement = Announcement.current()
    return {
        "brand_name": store.brand_name,
        "tagline": store.tagline,
        "currency": store.currency,
        "support_email": store.support_email,
        "support_phone": store.support_phone,
        "business_address": store.business_address,
        "logo": media_url(store.logo),
        "tax_label": store.tax_label,
        "tax_rate": f"{store.tax_rate:.2f}",
        "prices_include_tax": store.prices_include_tax,
        "ordering_enabled": store.ordering_enabled,
        "enable_reviews": store.enable_reviews,
        "checkout_methods": checkout_method_keys(store),
        "social": [
            {"platform": s.platform, "url": s.url, "handle": s.handle, "is_placeholder": s.is_placeholder}
            for s in SocialProfile.objects.filter(is_active=True)
        ],
        "announcement": (
            {"id": announcement.pk, "message": announcement.message, "link_url": announcement.link_url}
            if announcement
            else None
        ),
    }


def store_payload() -> dict:
    return cached("settings", ("store",), _build_store_payload)


def _block_dict(block: ContentBlock) -> dict:
    return {
        "key": block.key,
        "eyebrow": block.eyebrow,
        "title": block.title,
        "body": block.body,
        "image": media_url(block.image),
        "cta_label": block.cta_label,
        "cta_url": block.cta_url,
    }


def content_blocks_payload() -> dict:
    def build():
        return {b.key: _block_dict(b) for b in ContentBlock.objects.filter(is_active=True)}

    return cached("settings", ("blocks",), build)


def content_page_payload(slug: str) -> dict | None:
    def build():
        page = ContentPage.objects.filter(slug=slug, is_published=True).first()
        if page is None:
            return {}
        return {
            "slug": page.slug,
            "title": page.title,
            "summary": page.summary,
            "body_markdown": page.body_markdown,
            "updated_at": page.updated_at.isoformat(),
        }

    return cached("settings", ("page", slug), build) or None
