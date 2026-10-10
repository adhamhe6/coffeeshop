"""Versioned cache helper. Invalidate a namespace by bumping its version; stale keys expire via TTL.

Cache keys: `lantern:v{n}:{namespace}:{...}`; namespaces in use: `catalog` (menu, categories, collections, product detail),
`settings` (store settings/branches). TTLs default to 60s. Only public, non-user-specific data may be cached.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from typing import Any

from django.core.cache import cache

log = logging.getLogger(__name__)


def _version(namespace: str) -> int:
    v = cache.get(f"ver:{namespace}")
    if v is None:
        cache.set(f"ver:{namespace}", 1, None)
        return 1
    return v


def bump(namespace: str) -> None:
    try:
        cache.incr(f"ver:{namespace}")
    except ValueError:
        cache.set(f"ver:{namespace}", 2, None)
    except Exception:  # Redis down: TTL expiry is the fallback
        log.warning("cache version bump failed for %s", namespace)


def cached(namespace: str, parts: Any, builder: Callable[[], Any], ttl: int = 60) -> Any:
    digest = hashlib.sha1(repr(parts).encode(), usedforsecurity=False).hexdigest()[:20]
    key = f"{namespace}:v{_version(namespace)}:{digest}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    value = builder()
    cache.set(key, value, ttl)
    return value
