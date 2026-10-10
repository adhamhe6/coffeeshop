"""Pagination for responses whose item payloads are cached (page → plain dicts), keeping the standard envelope."""

from __future__ import annotations

from collections.abc import Callable

from django.utils.http import urlencode
from rest_framework.exceptions import NotFound

from apps.core.cache import cached
from apps.core.pagination import StandardPagination


def _page_params(request) -> tuple[int, int]:
    try:
        size = int(request.query_params.get(StandardPagination.page_size_query_param, StandardPagination.page_size))
    except ValueError:
        size = StandardPagination.page_size
    size = max(1, min(size, StandardPagination.max_page_size))
    try:
        page = int(request.query_params.get("page", 1))
    except ValueError:
        raise NotFound("Invalid page.")
    if page < 1:
        raise NotFound("Invalid page.")
    return page, size


def _link(request, page: int | None):
    if page is None:
        return None
    params = request.query_params.copy()
    params["page"] = str(page)
    return request.build_absolute_uri(request.path) + "?" + urlencode(params, doseq=True)


def cached_page(request, parts, build: Callable[[int, int], tuple[int, list]], *, namespace: str = "catalog") -> dict:
    """Return {count,next,previous,results}. `build(offset, size) -> (count, plain_items)` runs only on a cache miss.

    `parts` is the cache key material (must not contain per-user or per-branch data).
    """
    page, size = _page_params(request)

    def builder():
        count, items = build((page - 1) * size, size)
        return {"count": count, "items": items}

    data = cached(namespace, (parts, page, size), builder)
    count = data["count"]
    if page > 1 and (page - 1) * size >= count:
        raise NotFound("Invalid page.")
    return {
        "count": count,
        "next": _link(request, page + 1 if page * size < count else None),
        "previous": _link(request, page - 1 if page > 1 else None),
        "results": [dict(item) for item in data["items"]],
    }
