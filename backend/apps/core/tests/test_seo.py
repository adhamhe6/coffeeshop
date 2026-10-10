import json
import re
from decimal import Decimal
from xml.etree import ElementTree

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import Review
from apps.core import seo
from apps.core.models import ContentPage, SocialProfile, StoreSettings
from tests.factories import make_branch, make_category, make_product, make_stock, make_user

pytestmark = pytest.mark.django_db

INDEX = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Static default title</title>
    <meta name="description" content="static description" />
    <meta property="og:title" content="static og title" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="https://static.example/" />
    <script type="application/ld+json">{"@type":"Static"}</script>
    <script type="module" src="/assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
"""
XSS = '</script><script>alert(1)</script>"><img src=x onerror=alert(1)>'
SITE = "https://shop.example.com"


@pytest.fixture(autouse=True)
def frontend(tmp_path, settings):
    path = tmp_path / "index.html"
    path.write_text(INDEX, encoding="utf-8")
    settings.FRONTEND_INDEX_HTML = str(path)
    settings.SITE_URL = SITE
    seo._index_cache.update(path=None, mtime=None, html=None)
    return path


@pytest.fixture
def client():
    return APIClient()


def ld_blocks(html):
    out = []
    for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, flags=re.S):
        out.append(json.loads(raw))
    return out


def meta(html, name=None, prop=None):
    attr, key = ("name", name) if name else ("property", prop)
    found = re.findall(rf'<meta {attr}="{re.escape(key)}" content="([^"]*)">', html)
    return found


def canonical(html):
    return re.findall(r'<link rel="canonical" href="([^"]*)">', html)


class TestRobots:
    def test_content(self, client):
        res = client.get("/robots.txt")
        assert res.status_code == 200 and res["Content-Type"].startswith("text/plain")
        lines = res.content.decode().splitlines()
        for path in [
            "/admin",
            "/account",
            "/cart",
            "/checkout",
            "/orders",
            "/pay",
            "/api",
            "/django-admin",
            "/login",
            "/register",
        ]:
            assert f"Disallow: {path}" in lines
        assert f"Sitemap: {SITE}/sitemap.xml" in lines
        assert "User-agent: *" in lines

    def test_post_not_allowed(self, client):
        assert client.post("/robots.txt").status_code == 405


class TestSitemap:
    def test_urls(self, client):
        cat = make_category("Espresso")
        hidden_cat = make_category("Hidden", is_active=False)
        live = make_product("Latte", category=cat)
        make_product("Archived", category=cat, is_active=False)
        make_product("In hidden category", category=hidden_cat)
        ContentPage.objects.create(slug="about", title="About")
        ContentPage.objects.create(slug="faq", title="FAQ", is_published=False)
        ContentPage.objects.create(slug="custom-extra", title="Not routed")
        res = client.get("/sitemap.xml")
        assert res.status_code == 200 and res["Content-Type"].startswith("application/xml")
        root = ElementTree.fromstring(res.content)
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        locs = [u.find("s:loc", ns).text for u in root.findall("s:url", ns)]
        assert locs[0] == f"{SITE}/" and f"{SITE}/menu" in locs and f"{SITE}/locations" in locs
        assert f"{SITE}/menu/{cat.slug}" in locs and f"{SITE}/menu/{hidden_cat.slug}" not in locs
        assert f"{SITE}/p/{live.slug}" in locs
        assert not any("archived" in loc.lower() or "hidden" in loc.lower() for loc in locs)
        assert f"{SITE}/about" in locs and f"{SITE}/faq" not in locs and not any("custom-extra" in loc for loc in locs)
        lastmods = {u.find("s:loc", ns).text: u.find("s:lastmod", ns) for u in root.findall("s:url", ns)}
        assert lastmods[f"{SITE}/p/{live.slug}"].text == timezone.now().date().isoformat()
        assert all(loc.startswith(SITE) for loc in locs)

    def test_absolute_urls_follow_site_url_and_escape(self, client, settings):
        settings.SITE_URL = "https://other.example.org/"
        product = make_product("Tea")
        product.slug = "r-and-b"
        product.save()
        res = client.get("/sitemap.xml")
        text = res.content.decode()
        assert "https://other.example.org/p/r-and-b" in text and SITE not in text
        ElementTree.fromstring(res.content)  # well-formed

    def test_cached_and_refreshed_after_bump(self, client, django_assert_num_queries):
        client.get("/sitemap.xml")
        with django_assert_num_queries(0):
            client.get("/sitemap.xml")
        product = make_product("Brand New")
        from apps.core.cache import bump

        bump("catalog")
        assert product.slug in client.get("/sitemap.xml").content.decode()


class TestShellBasics:
    def test_home_injects_head(self, client):
        StoreSettings.objects.update_or_create(
            pk=1, defaults={"brand_name": "Moka Roasters", "tagline": "Dark & bold", "support_phone": "+1 555 010 0100"}
        )
        SocialProfile.objects.create(platform="instagram", url="https://instagram.com/moka")
        SocialProfile.objects.create(platform="x", url="https://x.com/demo", is_placeholder=True)
        res = client.get("/")
        assert res.status_code == 200 and res["Content-Type"].startswith("text/html")
        html = res.content.decode()
        assert html.count("<title>") == 1 and "<title>Moka Roasters — Dark &amp; bold</title>" in html
        assert "Static default title" not in html and "static description" not in html and "static.example" not in html
        assert '"@type":"Static"' not in html and 'content="index,follow"' not in html
        assert canonical(html) == [f"{SITE}/"]
        assert meta(html, prop="og:url") == [f"{SITE}/"] and meta(html, prop="og:site_name") == ["Moka Roasters"]
        assert meta(html, name="twitter:card") and len(meta(html, name="description")) == 1
        assert '<script type="module" src="/assets/index-abc.js"></script>' in html and 'id="root"' in html
        blocks = ld_blocks(html)
        graph = {b["@type"]: b for b in blocks[0]["@graph"]}
        assert set(graph) == {"CafeOrCoffeeShop", "WebSite"}
        assert graph["CafeOrCoffeeShop"]["name"] == "Moka Roasters"
        assert graph["CafeOrCoffeeShop"]["sameAs"] == ["https://instagram.com/moka"]  # placeholders excluded
        assert graph["WebSite"]["potentialAction"]["@type"] == "SearchAction"
        assert "noindex" not in html
        assert res["Cache-Control"] == "no-cache"

    def test_head_request_and_post(self, client):
        assert client.head("/").status_code == 200
        assert client.post("/", {}).status_code == 405

    def test_head_is_inside_head_element(self, client):
        html = client.get("/menu").content.decode()
        head = html[html.index("<head>") : html.index("</head>")]
        assert "<title>" in head and 'rel="canonical"' in head

    @pytest.mark.parametrize(
        "path",
        [
            "/login",
            "/register",
            "/forgot-password",
            "/reset-password",
            "/account",
            "/account/addresses",
            "/cart",
            "/checkout",
            "/orders/DT-1/confirmation",
            "/pay/demo/abc",
            "/admin",
            "/admin/orders",
            "/search",
            "/favorites",
            "/nonexistent-route",
        ],
    )
    def test_private_and_unknown_routes_are_noindex(self, client, path):
        res = client.get(path)
        assert res.status_code == 200
        html = res.content.decode()
        assert '<meta name="robots" content="noindex,nofollow">' in html
        assert "application/ld+json" not in html and 'rel="canonical"' not in html and "og:title" not in html
        assert "<title>" in html and "Static default title" not in html

    @pytest.mark.parametrize("path", ["/menu", "/menu/", "/locations", "/contact"])
    def test_public_static_pages_are_indexable(self, client, path):
        res = client.get(path)
        assert res.status_code == 200
        html = res.content.decode()
        assert "noindex" not in html and canonical(html)

    def test_trailing_slash_canonical(self, client):
        assert canonical(client.get("/menu/").content.decode()) == [f"{SITE}/menu"]

    def test_content_pages(self, client):
        ContentPage.objects.create(
            slug="about", title="About <us>", summary="", body_markdown="# Our *story*\n\nWe roast [beans](http://x.y)."
        )
        res = client.get("/about")
        html = res.content.decode()
        assert res.status_code == 200 and "About &lt;us&gt; |" in html and "About <us>" not in html
        assert meta(html, name="description") == ["Our story We roast beans."]
        assert canonical(html) == [f"{SITE}/about"]

    @pytest.mark.parametrize("slug", ["faq", "privacy", "terms", "refund-policy", "about"])
    def test_missing_or_unpublished_content_page_is_404(self, client, slug):
        ContentPage.objects.create(slug="faq", title="FAQ", is_published=False)
        res = client.get(f"/{slug}")
        assert res.status_code == 404 and 'id="root"' in res.content.decode()
        assert "noindex" in res.content.decode()


class TestCatalogPages:
    def test_category_page(self, client):
        cat = make_category("Cold <Brew>", description="Slow & smooth")
        res = client.get(f"/menu/{cat.slug}")
        html = res.content.decode()
        assert res.status_code == 200
        assert "<title>Cold &lt;Brew&gt; |" in html and meta(html, name="description") == ["Slow &amp; smooth"]
        crumbs = ld_blocks(html)[0]
        assert crumbs["@type"] == "BreadcrumbList"
        assert [i["name"] for i in crumbs["itemListElement"]] == ["Home", "Menu", "Cold <Brew>"]
        assert crumbs["itemListElement"][2]["item"] == f"{SITE}/menu/{cat.slug}"

    def test_unknown_or_inactive_category_is_real_404_but_serves_spa(self, client):
        inactive = make_category("Gone", is_active=False)
        for path in ("/menu/does-not-exist", f"/menu/{inactive.slug}"):
            res = client.get(path)
            html = res.content.decode()
            assert res.status_code == 404 and 'id="root"' in html and "/assets/index-abc.js" in html
            assert "noindex" in html and "application/ld+json" not in html

    def test_product_page_jsonld(self, client):
        cat = make_category("Espresso")
        product = make_product("Flat White", price="4.5", category=cat, short_description="Velvety & strong")
        product.image = "products/flat-white.webp"
        product.save()
        res = client.get(f"/p/{product.slug}")
        html = res.content.decode()
        assert res.status_code == 200
        assert "<title>Flat White |" in html and meta(html, name="description") == ["Velvety &amp; strong"]
        assert canonical(html) == [f"{SITE}/p/{product.slug}"]
        assert meta(html, prop="og:image") == [f"{SITE}/media/products/flat-white.webp"]  # absolute
        assert meta(html, prop="og:type") == ["product"] and meta(html, prop="product:price:amount") == ["4.50"]
        assert meta(html, name="twitter:card") == ["summary_large_image"]
        blocks = {b["@type"]: b for b in ld_blocks(html)}
        data = blocks["Product"]
        assert (
            data["name"] == "Flat White"
            and data["sku"] == product.sku
            and data["image"] == [f"{SITE}/media/products/flat-white.webp"]
        )
        offer = data["offers"]
        assert offer == {
            "@type": "Offer",
            "url": f"{SITE}/p/{product.slug}",
            "price": "4.50",
            "priceCurrency": "USD",
            "availability": "https://schema.org/InStock",
        }
        assert "aggregateRating" not in data
        crumbs = blocks["BreadcrumbList"]["itemListElement"]
        assert [c["name"] for c in crumbs] == ["Home", "Menu", "Espresso", "Flat White"]
        assert [c["position"] for c in crumbs] == [1, 2, 3, 4]

    def test_availability_variants(self, client):
        sold_out = make_product("Sold", is_sold_out=True)
        stocked_empty = make_product("Beans none", stocked=True)
        stocked_ok = make_product("Beans ok", stocked=True)
        branch = make_branch()
        make_stock(branch, stocked_empty, quantity=0)
        make_stock(branch, stocked_ok, quantity=3)

        def availability(product):
            html = client.get(f"/p/{product.slug}").content.decode()
            return ld_blocks(html)[0]["offers"]["availability"]

        assert availability(sold_out).endswith("OutOfStock")
        assert availability(stocked_empty).endswith("OutOfStock")
        assert availability(stocked_ok).endswith("InStock")

    def test_aggregate_rating_ignores_demo_and_unapproved_reviews(self, client):
        product = make_product("Rated")
        u1, u2, u3, u4 = (make_user() for _ in range(4))
        Review.objects.create(product=product, user=u1, rating=5, status="APPROVED")
        Review.objects.create(product=product, user=u2, rating=4, status="APPROVED")
        Review.objects.create(product=product, user=u3, rating=1, status="PENDING")
        Review.objects.create(product=product, user=u4, rating=1, status="APPROVED", is_demo=True)
        rating = ld_blocks(client.get(f"/p/{product.slug}").content.decode())[0]["aggregateRating"]
        assert rating == {"@type": "AggregateRating", "ratingValue": "4.5", "reviewCount": 2}

    def test_unknown_inactive_and_hidden_category_products_are_404(self, client):
        archived = make_product("Archived", is_active=False)
        hidden = make_product("Orphan", category=make_category("Off", is_active=False))
        for path in ("/p/nope", f"/p/{archived.slug}", f"/p/{hidden.slug}"):
            res = client.get(path)
            assert res.status_code == 404, path
            html = res.content.decode()
            assert 'id="root"' in html and "noindex" in html and "Archived" not in html and "Orphan" not in html

    def test_xss_payload_in_product_is_neutralised_everywhere(self, client):
        category = make_category(XSS)
        product = make_product(XSS, category=category, short_description=XSS)
        product.description = XSS
        product.save()
        for path in (f"/p/{product.slug}", f"/menu/{category.slug}"):
            res = client.get(path)
            html = res.content.decode()
            assert res.status_code == 200
            assert "<script>alert(1)" not in html and "</script><script" not in html
            assert "<img src=x" not in html and "onerror=alert(1)>" not in html.replace("&gt;", "")
            head = html[: html.index("</head>")]
            # exactly the app bundle + our JSON-LD blocks; nothing smuggled in
            assert len(re.findall(r"<script\b", head)) == 1 + len(ld_blocks(html))
            # JSON-LD stays valid JSON after escaping and round-trips the exact original text
            names = json.dumps(ld_blocks(html), ensure_ascii=False)
            assert json.dumps(XSS)[1:-1] in names
            assert "&lt;/script&gt;" in html  # title/meta escaped as text
        # the raw JSON-LD text contains no literal angle brackets at all
        raw = re.findall(
            r'<script type="application/ld\+json">(.*?)</script>',
            client.get(f"/p/{product.slug}").content.decode(),
            flags=re.S,
        )
        assert raw and all("<" not in r and ">" not in r for r in raw)

    def test_store_branding_values_are_escaped(self, client):
        StoreSettings.objects.update_or_create(
            pk=1, defaults={"brand_name": 'Evil"><script>alert(1)</script>', "tagline": "t"}
        )
        html = client.get("/").content.decode()
        assert "<script>alert(1)" not in html
        assert re.findall(r'<meta property="og:site_name" content="([^"]*)">', html) == [
            "Evil&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"
        ]


class TestShellRouting:
    @pytest.mark.parametrize(
        "path",
        [
            "/media/x.png",
            "/static/app.css",
            "/assets/index-abc.js",
            "/api/v1/nope",
            "/django-admin/nope",
            "/favicon.ico",
            "/some/file.map",
        ],
    )
    def test_excluded_paths_never_return_the_spa(self, client, path):
        res = client.get(path)
        assert res.status_code in (301, 302, 404)
        assert 'id="root"' not in res.content.decode(errors="ignore")

    def test_api_routes_still_win(self, client):
        assert client.get("/api/v1/health/live/").status_code == 200
        assert client.get("/healthz").status_code == 200
        assert client.get("/robots.txt")["Content-Type"].startswith("text/plain")
        assert client.get("/sitemap.xml")["Content-Type"].startswith("application/xml")

    def test_index_is_reloaded_when_the_file_changes(self, client, frontend):
        assert "v1-marker" not in client.get("/menu").content.decode()
        frontend.write_text(INDEX.replace("<body>", "<body><!-- v1-marker -->"), encoding="utf-8")
        import os

        os.utime(frontend, ns=(1, 2_000_000_000_000_000_000))
        assert "v1-marker" in client.get("/menu").content.decode()

    def test_index_html_is_read_once_per_version(self, client, monkeypatch):
        client.get("/menu")
        calls = []
        real_open = open
        monkeypatch.setattr("builtins.open", lambda *a, **k: calls.append(a) or real_open(*a, **k))
        client.get("/menu")
        client.get("/cart")
        assert not [c for c in calls if str(c[0]).endswith("index.html")]

    def test_missing_index_is_503_in_production(self, client, settings, tmp_path):
        settings.FRONTEND_INDEX_HTML = str(tmp_path / "missing.html")
        settings.DEBUG = False
        res = client.get("/menu")
        assert res.status_code == 503
        html = res.content.decode()
        assert html.lstrip().lower().startswith("<!doctype html>") and "temporarily unavailable" in html.lower()
        assert str(tmp_path) not in html  # no filesystem paths leaked

    def test_missing_index_in_debug_explains_what_to_do(self, client, settings, tmp_path):
        settings.FRONTEND_INDEX_HTML = str(tmp_path / "missing.html")
        settings.DEBUG = True
        res = client.get("/menu")
        assert res.status_code == 200
        html = res.content.decode()
        assert "Frontend not built" in html and "npm run build" in html

    def test_template_without_head_element_still_gets_tags(self, client, frontend):
        frontend.write_text("<html><body><div id='root'></div></body></html>", encoding="utf-8")
        html = client.get("/menu").content.decode()
        assert "<title>Menu |" in html and "<div id='root'>" in html


class TestInjectionUnit:
    def test_json_ld_script_is_script_safe(self):
        out = seo.json_ld_script({"a": "</script><!--", "b": "x&y", "c": " "})
        inner = out[len('<script type="application/ld+json">') : -len("</script>")]
        assert "<" not in inner and ">" not in inner and " " not in inner
        assert json.loads(inner) == {"a": "</script><!--", "b": "x&y", "c": " "}

    def test_replacement_text_with_backslashes_is_preserved(self):
        out = seo.inject_head("<html><head><title>x</title></head></html>", r"<title>\1 \g<0> \n</title>")
        assert r"<title>\1 \g<0> \n</title>" in out

    def test_plain_text_truncates_on_word_boundary(self):
        text = seo.plain_text("word " * 100, limit=40)
        assert len(text) <= 40 and text.endswith("…")

    def test_decimal_price_formatting(self):
        assert f"{Decimal('4.5'):.2f}" == "4.50"
