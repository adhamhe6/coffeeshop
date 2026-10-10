import pytest

from apps.catalog.models import Product, Tag
from apps.catalog.search import normalize_query, search_products
from tests.factories import make_category, make_product

pytestmark = pytest.mark.django_db

URL = "/api/v1/products/"


@pytest.fixture
def menu():
    espresso = make_category("Espresso Bar")
    brewed = make_category("Slow Brew")
    return {
        "cap": make_product("Cappuccino", category=espresso, short_description="Velvety milk foam"),
        "latte": make_product(
            "Iced Caramel Latte", category=espresso, description="Espresso, milk and caramel over ice"
        ),
        "caramel": make_product("Caramel Macchiato", category=espresso),
        "pour": make_product(
            "Pour Over", category=brewed, description="Single origin filter coffee with a caramel finish"
        ),
        "cold": make_product("Cold Brew", category=brewed),
        "almond": make_product("Almond Croissant", category=brewed, allergens=["gluten", "tree nuts"]),
    }


def found(api, q, **extra):
    params = "&".join(f"{k}={v}" for k, v in {"q": q, **extra}.items())
    r = api.get(f"{URL}?{params}")
    assert r.status_code == 200
    return [p["name"] for p in r.json()["results"]]


def test_empty_results_return_empty_list(api, menu):
    r = api.get(URL + "?q=xyzzyplugh")
    assert r.status_code == 200
    assert r.json() == {"count": 0, "next": None, "previous": None, "results": []}


@pytest.mark.parametrize("q", ["", "   "])
def test_blank_query_is_the_full_menu(api, menu, q):
    assert api.get(URL, {"q": q}).json()["count"] == 6


@pytest.mark.parametrize("q", ["%%%", "!!"])
def test_symbol_only_query_matches_nothing(api, menu, q):
    assert api.get(URL, {"q": q}).json()["count"] == 0


def test_wildcards_are_literal(api, menu):
    assert found(api, "%") == []
    assert found(api, "_") == []


def test_exact_prefix_word_substring_description_ranking(api, menu):
    # "caramel": prefix of Caramel Macchiato, word in Iced Caramel Latte, description of Pour Over
    assert found(api, "caramel") == ["Caramel Macchiato", "Iced Caramel Latte", "Pour Over"]
    # exact name beats prefix
    exact = make_product("Cap", category=menu["cap"].category)
    assert found(api, "cap")[:2] == ["Cap", "Cappuccino"]
    assert exact.name == "Cap"


def test_case_insensitive(api, menu):
    assert found(api, "CAPPUCCINO") == ["Cappuccino"]


def test_typo_tolerance(api, menu):
    assert "Cappuccino" in found(api, "capuccino")
    assert "Cappuccino" in found(api, "cappucino")
    assert "Caramel Macchiato" in found(api, "caramle machiato")
    assert "Cold Brew" in found(api, "cold bru")
    assert "Almond Croissant" in found(api, "croisant")


def test_matches_descriptions_categories_tags_and_allergens(api, menu):
    assert found(api, "velvety") == ["Cappuccino"]  # short description
    assert "Iced Caramel Latte" in found(api, "over ice")  # description phrase
    assert set(found(api, "slow brew")) >= {"Pour Over", "Cold Brew", "Almond Croissant"}  # category name
    tag = Tag.objects.create(name="Cozy", slug="cozy")
    menu["cold"].tags.add(tag)
    assert found(api, "cozy") == ["Cold Brew"]
    assert found(api, "gluten") == ["Almond Croissant"]
    assert found(api, "tree nuts") == ["Almond Croissant"]


def test_all_words_may_match_in_different_fields(api, menu):
    # "slow" is the category, "croissant" the name
    assert found(api, "slow croissant") == ["Almond Croissant"]


def test_inactive_products_and_categories_excluded(api, menu):
    menu["cap"].is_active = False
    menu["cap"].save()
    assert "Cappuccino" not in found(api, "cappuccino")
    cat = make_category("Gone", is_active=False)
    make_product("Cappuccino Deluxe", category=cat)
    assert "Cappuccino Deluxe" not in found(api, "cappuccino")


def test_search_combines_with_filters(api, menu):
    assert found(api, "caramel", category=menu["pour"].category.slug) == ["Pour Over"]
    assert found(api, "caramel", ordering="name") == ["Caramel Macchiato", "Iced Caramel Latte", "Pour Over"]
    assert found(api, "caramel", ordering="-name")[0] == "Pour Over"


def test_relevance_ordering_param_without_q_falls_back_to_menu(api, menu):
    r = api.get(URL + "?ordering=relevance")
    assert r.status_code == 200 and r.json()["count"] == 6


def test_service_function_returns_queryset_unchanged_for_empty_query():
    make_product("A")
    qs = Product.objects.all()
    assert search_products(qs, "   ").count() == 1
    assert normalize_query("  a   b \n c ") == "a b c"
    assert len(normalize_query("x" * 500)) == 80


def test_long_and_odd_queries_do_not_error(api, menu):
    for q in ("a" * 300, "café ☕", "\\", "(", "[a-z", "name:'; DROP TABLE x;--", "latte " * 20):
        assert api.get(URL, {"q": q}).status_code == 200
