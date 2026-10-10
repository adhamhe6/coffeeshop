import pytest
from django.core.cache import cache

from apps.cart.tests.fixtures import shop  # noqa: F401  (checkout flow tests)
from apps.payments.tests.helpers import block_stripe_network


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _no_stripe_network(monkeypatch):
    block_stripe_network(monkeypatch)
