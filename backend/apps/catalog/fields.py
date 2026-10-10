"""Serializer fields shared by the catalog, branches and inventory APIs."""

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers


@extend_schema_field({"type": "string", "nullable": True, "example": "/media/products/flat-white.webp"})
class ImageUrlField(serializers.Field):
    """Read-only root-relative URL of an ImageField (`/media/...`, or null when no file) - plan rule 12."""

    def __init__(self, **kwargs):
        kwargs["read_only"] = True
        super().__init__(**kwargs)

    def to_representation(self, value):
        return value.url if value else None

    def get_attribute(self, instance):
        # An empty FieldFile is falsy but not None; DRF would otherwise skip to_representation for None only.
        return super().get_attribute(instance) or None
