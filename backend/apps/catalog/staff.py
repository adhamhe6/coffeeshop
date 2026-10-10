"""Shared plumbing for staff (admin) API views in catalog, branches and inventory."""

from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers
from rest_framework.permissions import SAFE_METHODS

from apps.accounts.permissions import HasCapability
from apps.core.cache import bump
from apps.core.errors import DomainError


class CapabilityViewMixin:
    """`read_capability` guards safe methods, `write_capability` everything else (HasCapability does the check)."""

    read_capability: str = ""
    write_capability: str = ""

    def get_permissions(self):
        cap = self.read_capability if self.request.method in SAFE_METHODS else self.write_capability
        return [HasCapability.require(cap)()]


def jsonable(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def snapshot(instance, fields: list[str]) -> dict:
    return {f: jsonable(getattr(instance, f)) for f in fields}


def diff(before: dict, after: dict) -> dict:
    """{field: {"old": …, "new": …}} for every key whose value differs."""
    return {k: {"old": before.get(k), "new": after.get(k)} for k in after if before.get(k) != after.get(k)}


def duplicate_error() -> DomainError:
    return DomainError("That value is already in use.", code="duplicate", status_code=409)


def apply_order(model, ids: list[int], *, field: str = "sort_order", queryset=None):
    """Assign sort_order = position for the listed ids (all must exist in `queryset`). Bumps the catalog cache."""
    ids = list(dict.fromkeys(ids))
    objects = {o.pk: o for o in (queryset if queryset is not None else model.objects).filter(pk__in=ids)}
    missing = [i for i in ids if i not in objects]
    if missing:
        raise DomainError(
            "Some items do not exist.", code="invalid_ids", fields={"ids": [f"Unknown ids: {missing[:10]}"]}
        )
    changed = []
    for position, pk in enumerate(ids):
        obj = objects[pk]
        if getattr(obj, field) != position:
            setattr(obj, field, position)
            changed.append(obj)
    if changed:
        model.objects.bulk_update(changed, [field])
        bump("catalog")
    return [objects[i] for i in ids]


class ReorderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False, max_length=500)


class ImageUploadSerializer(serializers.Serializer):
    image = serializers.ImageField(help_text="JPEG, PNG or WebP; converted to WebP (max 1600px)")


class GalleryUploadSerializer(ImageUploadSerializer):
    alt_text = serializers.CharField(max_length=160, required=False, allow_blank=True)


class ImageResultSerializer(serializers.Serializer):
    image = serializers.CharField(allow_null=True)
