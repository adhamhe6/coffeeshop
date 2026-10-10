"""Cache invalidation: any change to catalog/branch data bumps the `catalog` cache namespace.

The version is bumped immediately (so the writer's own next read is fresh, also inside tests that never commit) and again
after commit (so a reader that cached stale data between the write and the commit cannot keep serving it).
"""

from django.db import transaction
from django.db.models.signals import m2m_changed, post_delete, post_save

from apps.branches.models import Branch, BranchClosure, BranchDeliveryZone, BranchHours, DeliveryZone
from apps.core.cache import bump

from .models import (
    Category,
    Collection,
    CollectionItem,
    ModifierGroup,
    ModifierOption,
    Product,
    ProductImage,
    ProductModifierGroup,
    Review,
    Tag,
)

WATCHED = (
    Product,
    ProductImage,
    Category,
    ModifierGroup,
    ModifierOption,
    ProductModifierGroup,
    Collection,
    CollectionItem,
    Tag,
    Review,  # rating averages shown on cards
    Branch,
    BranchHours,
    BranchClosure,
    BranchDeliveryZone,
    DeliveryZone,
)


def _invalidate(**kwargs):
    bump("catalog")
    transaction.on_commit(lambda: bump("catalog"))


for _model in WATCHED:
    post_save.connect(_invalidate, sender=_model, weak=False, dispatch_uid=f"catalog-bump-save-{_model.__name__}")
    post_delete.connect(_invalidate, sender=_model, weak=False, dispatch_uid=f"catalog-bump-delete-{_model.__name__}")


m2m_changed.connect(_invalidate, sender=Product.tags.through, weak=False, dispatch_uid="catalog-bump-product-tags")
