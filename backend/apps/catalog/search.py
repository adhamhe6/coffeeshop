"""Storefront product search on PostgreSQL (pg_trgm): substring matching across the catalogue plus typo tolerance.

A product matches a query when
  * the whole phrase appears (case-insensitive) in its name, short/long description, category name, a tag name or an
    allergen, or
  * every word of the query appears somewhere in those fields, or
  * its name is trigram-similar to the query (typo tolerance, e.g. "capuccino" -> "Cappuccino").
Rank (highest first): exact name > name prefix > word-start in name > name substring > tag/category > short
description > description, plus a small trigram-similarity bonus for tie-breaking.
"""

from __future__ import annotations

import re

from django.contrib.postgres.search import TrigramSimilarity, TrigramWordSimilarity
from django.db.models import Case, F, FloatField, Func, Q, TextField, Value, When
from django.db.models.functions import Greatest

from .models import Product

MAX_QUERY_LENGTH = 80
MAX_TOKENS = 6
WORD_SIMILARITY_MIN = 0.55
NAME_SIMILARITY_MIN = 0.3


def normalize_query(raw: str | None) -> str:
    return re.sub(r"\s+", " ", (raw or "")).strip()[:MAX_QUERY_LENGTH]


def _tag_product_ids(fragment: str):
    return Product.tags.through.objects.filter(tag__name__icontains=fragment).values("product_id")


def _field_q(fragment: str) -> Q:
    return (
        Q(name__icontains=fragment)
        | Q(short_description__icontains=fragment)
        | Q(description__icontains=fragment)
        | Q(category__name__icontains=fragment)
        | Q(allergen_text__icontains=fragment)
        | Q(id__in=_tag_product_ids(fragment))
    )


def search_products(queryset, raw_query: str | None):
    """Filter `queryset` of Product by the query and annotate `search_rank`. Returns it unchanged for an empty query."""
    query = normalize_query(raw_query)
    if not query:
        return queryset
    tokens = re.findall(r"\w+", query.lower())[:MAX_TOKENS]

    queryset = queryset.annotate(
        allergen_text=Func(F("allergens"), Value(" "), function="array_to_string", output_field=TextField()),
        word_sim=TrigramWordSimilarity(query, "name"),
        name_sim=TrigramSimilarity("name", query),
    )
    match = _field_q(query)
    if len(tokens) > 1:
        all_words = Q()
        for token in tokens:
            all_words &= _field_q(token)
        match |= all_words
    match |= Q(word_sim__gte=WORD_SIMILARITY_MIN) | Q(name_sim__gte=NAME_SIMILARITY_MIN)

    rank = Case(
        When(name__iexact=query, then=Value(100.0)),
        When(name__istartswith=query, then=Value(80.0)),
        When(name__iregex=r"\y" + re.escape(query), then=Value(60.0)),
        When(name__icontains=query, then=Value(45.0)),
        When(Q(id__in=_tag_product_ids(query)) | Q(category__name__icontains=query), then=Value(35.0)),
        When(short_description__icontains=query, then=Value(25.0)),
        When(description__icontains=query, then=Value(15.0)),
        default=Value(0.0),
        output_field=FloatField(),
    )
    return queryset.filter(match).annotate(search_rank=rank + Greatest(F("word_sim"), F("name_sim")) * 10)
