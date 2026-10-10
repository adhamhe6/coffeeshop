import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api():
    return APIClient(enforce_csrf_checks=False)


@pytest.fixture
def store_settings(db):
    from apps.core.models import StoreSettings

    return StoreSettings.load()


@pytest.fixture
def login(api):
    """login(user) → authenticated APIClient (force_login; session auth)."""

    def _login(user):
        api.force_login(user)
        return api

    return _login


@pytest.fixture(autouse=True)
def _clear_cache():
    """Locmem cache survives across tests; bulk updates bypass cache-bump signals."""
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()
