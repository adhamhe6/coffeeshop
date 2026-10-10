"""SEO surface: sitemap.xml, robots.txt and the SPA shell with per-page head tags.

The React SPA is served from a static `index.html`. For public routes we inject a title, description, canonical URL,
Open Graph/Twitter tags and JSON-LD built from database content so crawlers and link-preview bots see real metadata
without running JavaScript. Every injected value is HTML-escaped; JSON-LD is additionally made script-safe.
"""

from __future__ import annotations

import html
import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field
from xml.sax.saxutils import escape as xml_escape

from django.conf import settings
from django.http import HttpResponse, HttpResponseNotFound
from django.template.loader import render_to_string
from django.views.decorators.http import require_safe

from . import services
from .cache import cached

log = logging.getLogger(__name__)

PAGE_SLUGS = ("about", "faq", "privacy", "terms", "refund-policy")
PRIVATE_PREFIXES = (
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/account",
    "/cart",
    "/checkout",
    "/orders",
    "/pay",
    "/admin",
)
NOINDEX_PREFIXES = (*PRIVATE_PREFIXES, "/search", "/favorites")
PRIVATE_TITLES = {
    "/login": "Sign in",
    "/register": "Create account",
    "/forgot-password": "Forgot password",
    "/reset-password": "Reset password",
    "/account": "Your account",
    "/cart": "Your cart",
    "/checkout": "Checkout",
    "/orders": "Your orders",
    "/pay": "Payment",
    "/admin": "Admin",
    "/search": "Search",
    "/favorites": "Favourites",
}
_SLUG = re.compile(r"^[-\w]+$")
_FILE_EXTENSION = re.compile(r"\.[A-Za-z0-9]{1,8}$")
RESERVED_FIRST_SEGMENTS = {"api", "media", "static", "django-admin", "assets"}


# ── helpers ───────────────────────────────────────────────────────────────────
def site_origin() -> str:
    return settings.SITE_URL.rstrip("/")


def absolute_url(path_or_url: str | None) -> str | None:
    if not path_or_url:
        return None
    if "://" in path_or_url:
        return path_or_url
    return site_origin() + (path_or_url if path_or_url.startswith("/") else "/" + path_or_url)


def plain_text(value: str, limit: int = 160) -> str:
    """Collapse Markdown/whitespace into a short plain-text snippet for meta descriptions."""
    text = re.sub(r"```.*?```", " ", value or "", flags=re.S)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[#>*_`~|]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0].rstrip(",.;:- ") + "…"


def json_ld_script(data: dict) -> str:
    """Serialise JSON-LD so it can never terminate the surrounding <script> element."""
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    for char, repl in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), (" ", "\\u2028"), (" ", "\\u2029")):
        text = text.replace(char, repl)
    return f'<script type="application/ld+json">{text}</script>'


def _breadcrumbs(items: list[tuple[str, str]]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i, "name": name, "item": absolute_url(path)}
            for i, (name, path) in enumerate(items, start=1)
        ],
    }


@dataclass
class PageMeta:
    title: str
    description: str = ""
    path: str = "/"
    noindex: bool = False
    og_type: str = "website"
    image: str | None = None
    status: int = 200
    json_ld: list[dict] = field(default_factory=list)
    extra_meta: list[tuple[str, str]] = field(default_factory=list)  # (property, content)


# ── page resolution ───────────────────────────────────────────────────────────
def _brand() -> dict:
    return services.store_payload()


def _default_description(store: dict) -> str:
    return f"{store['tagline']} Order coffee, beans and food from {store['brand_name']} for pickup or delivery."


def _home_meta(store: dict) -> PageMeta:
    from apps.branches.models import Branch

    origin = site_origin()
    logo = absolute_url(store["logo"])
    locations = [
        {
            "@type": "Place",
            "name": b.name,
            "address": {
                "@type": "PostalAddress",
                "streetAddress": b.address_line,
                "addressLocality": b.city,
                "postalCode": b.postal_code,
            },
        }
        for b in Branch.objects.filter(is_active=True, is_placeholder_address=False)[:10]
    ]
    shop = {
        "@type": "CafeOrCoffeeShop",
        "@id": f"{origin}/#organization",
        "name": store["brand_name"],
        "url": origin,
        "email": store["support_email"],
        "sameAs": [s["url"] for s in store["social"] if not s["is_placeholder"]],
    }
    if store["support_phone"]:
        shop["telephone"] = store["support_phone"]
    if logo:
        shop["logo"] = logo
        shop["image"] = logo
    if locations:
        shop["location"] = locations
    website = {
        "@type": "WebSite",
        "@id": f"{origin}/#website",
        "name": store["brand_name"],
        "url": origin,
        "publisher": {"@id": f"{origin}/#organization"},
        "potentialAction": {
            "@type": "SearchAction",
            "target": f"{origin}/search?q={{search_term_string}}",
            "query-input": "required name=search_term_string",
        },
    }
    return PageMeta(
        title=f"{store['brand_name']} — {store['tagline']}",
        description=_default_description(store),
        path="/",
        image=logo,
        json_ld=[{"@context": "https://schema.org", "@graph": [shop, website]}],
    )


def _category_meta(slug: str, store: dict) -> PageMeta:
    from apps.catalog.models import Category

    path = f"/menu/{slug}"
    category = Category.objects.filter(slug=slug, is_active=True).first() if _SLUG.match(slug) else None
    if category is None:
        return PageMeta(title=f"Not found | {store['brand_name']}", path=path, noindex=True, status=404)
    return PageMeta(
        title=f"{category.name} | {store['brand_name']}",
        description=plain_text(category.description) or f"Browse {category.name} from {store['brand_name']}.",
        path=path,
        image=absolute_url(services.media_url(category.image)) or absolute_url(store["logo"]),
        json_ld=[_breadcrumbs([("Home", "/"), ("Menu", "/menu"), (category.name, path)])],
    )


def _product_availability(product) -> bool:
    if not product.is_active or product.is_sold_out:
        return False
    if product.stock_mode == "STOCKED":
        from django.db.models import Sum

        from apps.inventory.models import StockItem

        total = StockItem.objects.filter(product=product).aggregate(t=Sum("quantity"))["t"] or 0
        return total > 0
    return True


def _product_meta(slug: str, store: dict) -> PageMeta:
    from django.db.models import Avg, Count

    from apps.catalog.models import Product, Review

    path = f"/p/{slug}"
    product = (
        Product.objects.select_related("category").filter(slug=slug, is_active=True, category__is_active=True).first()
        if _SLUG.match(slug)
        else None
    )
    if product is None:
        return PageMeta(title=f"Not found | {store['brand_name']}", path=path, noindex=True, status=404)
    canonical = absolute_url(path)
    image = absolute_url(services.media_url(product.image)) or absolute_url(store["logo"])
    description = plain_text(product.short_description or product.description) or (
        f"{product.name} from {store['brand_name']}."
    )
    data: dict = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product.name,
        "description": description,
        "sku": product.sku,
        "category": product.category.name,
        "brand": {"@type": "Brand", "name": store["brand_name"]},
        "offers": {
            "@type": "Offer",
            "url": canonical,
            "price": f"{product.base_price:.2f}",
            "priceCurrency": store["currency"],
            "availability": "https://schema.org/InStock"
            if _product_availability(product)
            else "https://schema.org/OutOfStock",
        },
    }
    if image:
        data["image"] = [image]
    # Only genuine, approved reviews feed structured data; seeded demo reviews must never be advertised as real.
    rating = Review.objects.filter(product=product, status="APPROVED", is_demo=False).aggregate(
        avg=Avg("rating"), n=Count("id")
    )
    if rating["n"]:
        data["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": f"{rating['avg']:.1f}",
            "reviewCount": rating["n"],
        }
    return PageMeta(
        title=f"{product.name} | {store['brand_name']}",
        description=description,
        path=path,
        og_type="product",
        image=image,
        json_ld=[
            data,
            _breadcrumbs(
                [
                    ("Home", "/"),
                    ("Menu", "/menu"),
                    (product.category.name, f"/menu/{product.category.slug}"),
                    (product.name, path),
                ]
            ),
        ],
        extra_meta=[
            ("product:price:amount", f"{product.base_price:.2f}"),
            ("product:price:currency", store["currency"]),
        ],
    )


def _content_page_meta(slug: str, store: dict) -> PageMeta:
    page = services.content_page_payload(slug)
    path = f"/{slug}"
    if page is None:
        return PageMeta(title=f"Not found | {store['brand_name']}", path=path, noindex=True, status=404)
    return PageMeta(
        title=f"{page['title']} | {store['brand_name']}",
        description=plain_text(page["summary"] or page["body_markdown"]) or _default_description(store),
        path=path,
        image=absolute_url(store["logo"]),
    )


def resolve_page(raw_path: str) -> PageMeta:
    store = _brand()
    brand = store["brand_name"]
    path = "/" + raw_path.strip("/")
    if path == "/":
        return _home_meta(store)
    for prefix in NOINDEX_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return PageMeta(title=f"{PRIVATE_TITLES[prefix]} | {brand}", path=path, noindex=True)
    if path == "/menu":
        return PageMeta(
            title=f"Menu | {brand}",
            description=f"Coffee, tea, food and beans from {brand}. {store['tagline']}",
            path=path,
            image=absolute_url(store["logo"]),
            json_ld=[_breadcrumbs([("Home", "/"), ("Menu", "/menu")])],
        )
    if match := re.fullmatch(r"/menu/([^/]+)", path):
        return _category_meta(match.group(1), store)
    if match := re.fullmatch(r"/p/([^/]+)", path):
        return _product_meta(match.group(1), store)
    if path == "/locations":
        return PageMeta(
            title=f"Locations | {brand}",
            description=f"Find a {brand} near you: opening hours, pickup and delivery.",
            path=path,
            image=absolute_url(store["logo"]),
        )
    if path == "/contact":
        return PageMeta(
            title=f"Contact | {brand}",
            description=f"Get in touch with {brand}.",
            path=path,
            image=absolute_url(store["logo"]),
        )
    if path[1:] in PAGE_SLUGS:
        return _content_page_meta(path[1:], store)
    return PageMeta(title=f"Page not found | {brand}", path=path, noindex=True)


# ── head rendering and injection ──────────────────────────────────────────────
def render_head(meta: PageMeta) -> str:
    esc = lambda v: html.escape(str(v), quote=True)  # noqa: E731
    store = _brand()
    parts = [f"<title>{esc(meta.title)}</title>"]
    if meta.description:
        parts.append(f'<meta name="description" content="{esc(meta.description)}">')
    if meta.noindex:
        parts.append('<meta name="robots" content="noindex,nofollow">')
        return "\n    ".join(parts)
    canonical = absolute_url(meta.path if meta.path != "/" else "/")
    parts.append(f'<link rel="canonical" href="{esc(canonical)}">')
    og = [
        ("og:site_name", store["brand_name"]),
        ("og:type", meta.og_type),
        ("og:title", meta.title),
        ("og:url", canonical),
    ]
    if meta.description:
        og.append(("og:description", meta.description))
    if meta.image:
        og.append(("og:image", meta.image))
    og.extend(meta.extra_meta)
    parts.extend(f'<meta property="{esc(k)}" content="{esc(v)}">' for k, v in og)
    parts.append(f'<meta name="twitter:card" content="{"summary_large_image" if meta.image else "summary"}">')
    parts.append(f'<meta name="twitter:title" content="{esc(meta.title)}">')
    if meta.description:
        parts.append(f'<meta name="twitter:description" content="{esc(meta.description)}">')
    if meta.image:
        parts.append(f'<meta name="twitter:image" content="{esc(meta.image)}">')
    parts.extend(json_ld_script(block) for block in meta.json_ld)
    return "\n    ".join(parts)


_STRIP_PATTERNS = [
    re.compile(r"<title\b[^>]*>.*?</title>\s*", re.I | re.S),
    re.compile(
        r"<meta\b[^>]*?\b(?:name|property)\s*=\s*[\"'](?:description|robots|og:[^\"']*|twitter:[^\"']*|product:[^\"']*)[\"'][^>]*>\s*",
        re.I,
    ),
    re.compile(r"<link\b[^>]*?\brel\s*=\s*[\"']canonical[\"'][^>]*>\s*", re.I),
    re.compile(r"<script\b[^>]*?\btype\s*=\s*[\"']application/ld\+json[\"'][^>]*>.*?</script>\s*", re.I | re.S),
]
_HEAD_CLOSE = re.compile(r"</head\s*>", re.I)
_HEAD_OPEN = re.compile(r"<head\b[^>]*>", re.I)


def inject_head(index_html: str, head_fragment: str) -> str:
    """Remove the template's own title/description/canonical/OG/JSON-LD and insert ours (no regex replacement string)."""
    cleaned = index_html
    for pattern in _STRIP_PATTERNS:
        cleaned = pattern.sub("", cleaned)
    block = f"    {head_fragment}\n"
    close = _HEAD_CLOSE.search(cleaned)
    if close:
        return cleaned[: close.start()] + block + cleaned[close.start() :]
    opening = _HEAD_OPEN.search(cleaned)
    if opening:
        return cleaned[: opening.end()] + "\n" + block + cleaned[opening.end() :]
    return f"<head>\n{block}</head>\n{cleaned}"


# ── index.html (cached by mtime) ──────────────────────────────────────────────
_index_lock = threading.Lock()
_index_cache: dict = {"path": None, "mtime": None, "html": None}


def load_index_html() -> str | None:
    path = str(settings.FRONTEND_INDEX_HTML)
    try:
        mtime = os.stat(path).st_mtime_ns
    except OSError:
        return None
    with _index_lock:
        if _index_cache["path"] == path and _index_cache["mtime"] == mtime:
            return _index_cache["html"]
        try:
            with open(path, encoding="utf-8") as handle:
                content = handle.read()
        except OSError:
            return None
        _index_cache.update(path=path, mtime=mtime, html=content)
        return content


def _fallback_response() -> HttpResponse:
    debug = bool(settings.DEBUG)
    body = render_to_string(
        "seo/fallback.html",
        {
            "debug": debug,
            "message": (
                "The frontend build was not found. Run the Vite dev server (npm run dev in frontend/) or build it "
                f"(npm run build) and point FRONTEND_INDEX_HTML at dist/index.html. Looked for: {settings.FRONTEND_INDEX_HTML}"
                if debug
                else "The storefront is temporarily unavailable. Please try again shortly."
            ),
        },
    )
    return HttpResponse(body, status=200 if debug else 503, content_type="text/html; charset=utf-8")


@require_safe
def spa_shell(request, path: str = ""):
    """Catch-all for browser navigations: serve the SPA with route-specific head tags (404 status for unknown items)."""
    first = path.split("/", 1)[0]
    if first in RESERVED_FIRST_SEGMENTS or _FILE_EXTENSION.search(path):
        return HttpResponseNotFound("Not found", content_type="text/plain")
    index_html = load_index_html()
    if index_html is None:
        log.error("frontend index.html missing at %s", settings.FRONTEND_INDEX_HTML)
        return _fallback_response()
    meta = resolve_page(path)
    response = HttpResponse(
        inject_head(index_html, render_head(meta)), status=meta.status, content_type="text/html; charset=utf-8"
    )
    response["Cache-Control"] = "no-cache"
    return response


# ── sitemap & robots ──────────────────────────────────────────────────────────
def _w3c_date(value) -> str | None:
    return value.date().isoformat() if value else None


def _build_sitemap() -> str:
    from django.db.models import Max

    from apps.branches.models import Branch
    from apps.catalog.models import Category, Product
    from apps.core.models import ContentPage

    entries: list[tuple[str, str | None]] = [("/", None), ("/menu", None)]
    entries.extend((f"/menu/{c.slug}", _w3c_date(c.updated_at)) for c in Category.objects.filter(is_active=True))
    entries.extend(
        (f"/p/{p.slug}", _w3c_date(p.updated_at))
        for p in Product.objects.filter(is_active=True, category__is_active=True).order_by("slug")
    )
    entries.append(("/locations", _w3c_date(Branch.objects.filter(is_active=True).aggregate(m=Max("updated_at"))["m"])))
    entries.extend(
        (f"/{p.slug}", _w3c_date(p.updated_at))
        for p in ContentPage.objects.filter(is_published=True, slug__in=PAGE_SLUGS).order_by("slug")
    )
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path, lastmod in entries:
        lines.append("  <url>")
        lines.append(f"    <loc>{xml_escape(absolute_url(path))}</loc>")
        if lastmod:
            lines.append(f"    <lastmod>{lastmod}</lastmod>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


@require_safe
def sitemap_xml(request):
    body = cached("catalog", ("sitemap", site_origin()), _build_sitemap, ttl=300)
    response = HttpResponse(body, content_type="application/xml; charset=utf-8")
    response["Cache-Control"] = "public, max-age=300"
    return response


@require_safe
def robots_txt(request):
    body = render_to_string("seo/robots.txt", {"sitemap_url": f"{site_origin()}/sitemap.xml"})
    response = HttpResponse(body, content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "public, max-age=3600"
    return response
