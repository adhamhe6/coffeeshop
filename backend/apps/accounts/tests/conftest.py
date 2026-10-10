import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clean_cache():
    """Cache and throttle counters live in process memory during tests; never let them leak between tests."""
    cache.clear()
    yield
    cache.clear()
