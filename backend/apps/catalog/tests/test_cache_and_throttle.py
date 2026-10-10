import pytest
from django.core.cache import cache
from rest_framework.throttling import ScopedRateThrottle

from apps.branches.models import Branch, BranchClosure, BranchDeliveryZone, BranchHours, DeliveryZone
from apps.catalog.models import (
    Category,
    Collection,
    CollectionItem,
    ModifierGroup,
    ModifierOption,
    Product,
    ProductModifierGroup,
    Tag,
)
from apps.core.cache import cached
from apps.inventory.tests.helpers import make_order
from tests.factories import make_branch, make_category, make_modifier_group, make_product, make_user, make_zone

pytestmark = pytest.mark.django_db


def version():
    return cache.get("ver:catalog")


def bumps(action):
    before = version()
    action()
    after = version()
    return before is not None and after is not None and after > before


@pytest.fixture
def seed():
    cache.set("ver:catalog", 1, None)
    category = make_category()
    product = make_product(category=category)
    group, (option,) = make_modifier_group(product, "Size", options=[("L", "1")])
    collection = Collection.objects.create(name="C", slug="c")
    item = CollectionItem.objects.create(collection=collection, product=product)
    branch = make_branch(slug="b")
    zone = make_zone("Z", branch)
    return locals()


def test_every_watched_model_write_bumps_the_catalog_namespace(seed):
    s = seed

    def touch(obj, **fields):
        def run():
            for k, v in fields.items():
                setattr(obj, k, v)
            obj.save()

        return run

    checks = {
        "product": touch(s["product"], base_price="9.99"),
        "category": touch(s["category"], description="x"),
        "group": touch(s["group"], display_name="Other"),
        "option": touch(s["option"], price_delta="2.00"),
        "collection": touch(s["collection"], description="x"),
        "branch": touch(s["branch"], name="Renamed"),
        "zone": touch(s["zone"], name="Zone 2"),
        "tag create": lambda: Tag.objects.create(name="T", slug="t"),
        "collection item": lambda: CollectionItem.objects.filter(pk=s["item"].pk).first().delete(),
        "hours": lambda: (
            BranchHours.objects.create(branch=s["branch"], weekday=0, is_closed=True)
            if not BranchHours.objects.filter(branch=s["branch"], weekday=0).exists()
            else BranchHours.objects.filter(branch=s["branch"], weekday=0).first().delete()
        ),
        "closure": lambda: BranchClosure.objects.create(
            branch=s["branch"], start_date="2030-01-01", end_date="2030-01-02"
        ),
        "zone link": lambda: BranchDeliveryZone.objects.filter(branch=s["branch"]).first().delete(),
        "product tags": lambda: s["product"].tags.add(Tag.objects.first()),
        "product modifier link": lambda: ProductModifierGroup.objects.filter(product=s["product"]).first().delete(),
    }
    for label, action in checks.items():
        assert bumps(action), label
    assert (
        Product.objects
        and Category.objects
        and ModifierGroup.objects
        and ModifierOption.objects
        and Branch.objects
        and DeliveryZone.objects
    )


def test_stale_value_is_dropped_after_bump():
    calls = []
    assert cached("catalog", "k", lambda: calls.append(1) or "v1") == "v1"
    assert cached("catalog", "k", lambda: calls.append(1) or "v2") == "v1"  # served from cache
    make_product()  # any catalogue write
    assert cached("catalog", "k", lambda: calls.append(1) or "v2") == "v2"


def test_branch_availability_overlay_not_stored_in_cache(api):
    from apps.inventory.models import BranchProduct

    branch = make_branch(slug="b")
    product = make_product()
    url = "/api/v1/products/?branch=b"
    assert api.get(url).json()["results"][0]["is_available"] is True
    # availability toggles are not catalogue writes (no bump), yet must show up at once
    BranchProduct.objects.create(branch=branch, product=product, is_available=False)
    assert api.get(url).json()["results"][0]["unavailable_reason"] == "branch_unavailable"
    BranchProduct.objects.all().delete()
    assert api.get(url).json()["results"][0]["is_available"] is True


def test_review_post_is_throttled_but_reading_is_not(api, login, monkeypatch):
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"review": "2/min"})
    product = make_product()
    user = make_user()
    make_order(make_branch(), [(product, 1)], customer=user, status="COMPLETED")
    login(user)
    url = f"/api/v1/products/{product.slug}/reviews/"
    cache.clear()
    codes = [api.post(url, {"rating": 5}).status_code for _ in range(3)]
    assert codes[:2] == [201, 409] and codes[2] == 429
    assert api.post(url, {"rating": 5}).json()["error"]["code"] == "throttled"
    assert all(api.get(url).status_code == 200 for _ in range(5))
