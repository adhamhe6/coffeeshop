"""Dashboard caching (60 s, scope-keyed, no cross-scope leakage) and the query-count ceiling."""

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.models import StoreSettings  # noqa: F401  (ensures core app loaded)

from .conftest import D_FROM, D_TO
from .helpers import COFFEE, make_order, utc

pytestmark = pytest.mark.django_db

PARAMS = {"date_from": D_FROM.isoformat(), "date_to": D_TO.isoformat()}
URL = "/api/v1/admin/dashboard/"
DASHBOARD_MAX_QUERIES = 22  # measured 19 (3 of them auth/session); fails loudly on an N+1 regression


def gross(resp):
    return resp.json()["kpis"]["gross_sales"]["value"]


def test_dashboard_query_count_ceiling(world, api, login):
    login(world.users.admin)
    with CaptureQueriesContext(connection) as ctx:
        assert api.get(URL, PARAMS).status_code == 200
    assert len(ctx) <= DASHBOARD_MAX_QUERIES, [q["sql"][:90] for q in ctx]


def test_query_count_does_not_grow_with_data(world, api, login):
    login(world.users.admin)

    def count():
        cache.clear()
        with CaptureQueriesContext(connection) as ctx:
            assert api.get(URL, PARAMS).status_code == 200
        return len(ctx)

    before = count()
    for i in range(25):
        make_order(world.a, world.customers[i % 5], utc(2026, 9, 3 + i % 20, 9), [COFFEE(2)])
    assert count() == before


def test_second_request_is_served_from_cache(world, api, login):
    login(world.users.admin)
    first = api.get(URL, PARAMS)
    with CaptureQueriesContext(connection) as ctx:
        second = api.get(URL, PARAMS)
    assert second.json() == first.json()  # identical, including generated_at
    assert len(ctx) <= 5  # session, user, staff profile, branches (no report aggregates)
    # a new order is invisible until the TTL (or cache) expires: documented 60 s staleness
    make_order(world.a, world.customers[0], utc(2026, 9, 3, 9), [COFFEE(2)])
    assert gross(api.get(URL, PARAMS)) == gross(first)
    cache.clear()
    assert gross(api.get(URL, PARAMS)) != gross(first)


def test_cache_ttl_is_sixty_seconds(world, api, login, monkeypatch):
    seen = {}
    import apps.reports.views as views

    real = views.cached

    def spy(namespace, parts, builder, ttl=60):
        seen["ttl"], seen["parts"] = ttl, parts
        return real(namespace, parts, builder, ttl)

    monkeypatch.setattr(views, "cached", spy)
    login(world.users.admin)
    api.get(URL, PARAMS)
    assert seen["ttl"] == 60
    assert "all" in seen["parts"] and PARAMS["date_from"] in seen["parts"]


@pytest.mark.parametrize("warm_first", ["admin", "manager_a"])
def test_no_cross_scope_leakage_through_the_cache(world, api, login, warm_first):
    """Whichever scope warms the cache first, every other scope must still get its own numbers."""
    users = world.users
    order = [warm_first] + [
        n for n in ("admin", "manager_a", "manager_b", "manager_ab", "manager_none") if n != warm_first
    ]
    results = {}
    for name in order:
        login(getattr(users, name))
        r = api.get(URL, PARAMS)
        assert r.status_code == 200
        results[name] = r.json()
    expected = {
        "admin": None,
        "manager_a": {world.a.pk},
        "manager_b": {world.b.pk},
        "manager_ab": {world.a.pk, world.b.pk},
        "manager_none": set(),
    }
    for name, branch_ids in expected.items():
        exp = world.expected.kpis(D_FROM, D_TO, branch_ids)
        data = results[name]
        assert data["kpis"]["gross_sales"]["value"] == f"{exp['gross_sales']:.2f}", name
        assert data["kpis"]["orders_total"]["value"] == exp["orders_total"], name
        shown = {r["branch_id"] for r in data["branch_performance"]}
        assert shown == (branch_ids if branch_ids is not None else {world.a.pk, world.b.pk, world.c.pk}), name
        assert {o["branch"] for o in data["recent_orders"]} <= {
            b.name for b in (world.a, world.b, world.c) if branch_ids is None or b.pk in branch_ids
        }


def test_cache_key_differs_per_scope_params_and_capability(world, monkeypatch):
    import apps.reports.views as views

    keys = []
    real = views.cached

    def spy(namespace, parts, builder, ttl=60):
        keys.append(parts)
        return real(namespace, parts, builder, ttl)

    monkeypatch.setattr(views, "cached", spy)
    from rest_framework.test import APIClient

    def hit(user, **params):
        c = APIClient()
        c.force_login(user)
        assert c.get(URL, {**PARAMS, **params}).status_code == 200

    u = world.users
    hit(u.admin)
    hit(u.manager_a)
    hit(u.manager_b)
    hit(u.manager_ab)
    hit(u.admin, branch=world.a.pk)
    hit(u.admin, granularity="week")
    hit(u.admin, date_to="2026-09-29")
    hit(u.inventory)  # same branch scope as manager_a but no customers.view
    assert len(set(keys)) == len(keys), "every distinct scope/param/capability combination needs its own key"
    # identical effective scope + params + capability (admin picking branch A vs a branch-A manager) may share an entry
    n = len(keys)
    hit(u.manager_a, branch=world.a.pk)
    assert keys[n] == keys[4]
    assert {k[1] for k in keys} >= {"all", f"b:{world.a.pk}", f"b:{world.b.pk}", f"b:{world.a.pk},{world.b.pk}"}


def test_dashboard_survives_cache_outage(world, api, login, monkeypatch):
    """Redis down => django-redis ignores the exception and returns misses; simulate with a dead cache backend."""
    from django.core.cache.backends.locmem import LocMemCache

    monkeypatch.setattr(LocMemCache, "get", lambda self, *a, **k: None)
    monkeypatch.setattr(LocMemCache, "set", lambda self, *a, **k: None)
    login(world.users.admin)
    r = api.get(URL, PARAMS)
    assert r.status_code == 200 and gross(r) == "154.25"
