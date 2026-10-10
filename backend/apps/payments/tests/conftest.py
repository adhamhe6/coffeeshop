import pytest
from django.core.cache import cache

from apps.cart.tests.fixtures import auth, customer, shop  # noqa: F401  (shared checkout fixtures)

from .helpers import block_stripe_network


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _no_stripe_network(monkeypatch):
    block_stripe_network(monkeypatch)
