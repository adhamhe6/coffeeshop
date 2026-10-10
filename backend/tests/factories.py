"""Shared test factories (plain functions, no extra dependency). Import: `from tests.factories import make_product, ...`."""

from __future__ import annotations

import itertools
from datetime import time
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone

_seq = itertools.count(1)


def _n() -> int:
    return next(_seq)


def make_user(email: str | None = None, password: str = "Str0ng-pass-123", *, unverified: bool = False, **kw):
    """Users are email-VERIFIED by default (order emails are only sent to verified addresses); `unverified=True` opts out."""
    User = get_user_model()
    email = email or f"customer{_n()}@example.com"
    if not unverified:
        kw.setdefault("email_verified_at", timezone.now())
    kw.setdefault("first_name", "Test")
    kw.setdefault("last_name", "Customer")
    return User.objects.create_user(email=email, password=password, **kw)


def make_staff(role: str = "ADMIN", branches=(), email: str | None = None, password: str = "Str0ng-pass-123"):
    from apps.accounts.models import StaffProfile

    user = make_user(email or f"{role.lower()}{_n()}@example.com", password, is_staff=True)
    profile = StaffProfile.objects.create(user=user, role=role)
    if branches:
        profile.branches.set(branches)
    return user


def make_branch(code: str | None = None, *, pickup=True, delivery=True, open_all_week=True, **kw):
    from apps.branches.models import Branch, BranchHours

    n = _n()
    code = code or f"B{n}"
    branch = Branch.objects.create(
        code=code,
        name=kw.pop("name", f"Branch {n}"),
        slug=kw.pop("slug", f"branch-{n}"),
        address_line="1 Test Street",
        city="Testville",
        pickup_enabled=pickup,
        delivery_enabled=delivery,
        timezone=kw.pop("timezone", "UTC"),
        **kw,
    )
    if open_all_week:
        for wd in range(7):
            BranchHours.objects.create(branch=branch, weekday=wd, opens=time(0, 0), closes=time(23, 59))
    return branch


def make_zone(name: str | None = None, branch=None, fee="3.00", min_order="0.00", free_over=None):
    from apps.branches.models import BranchDeliveryZone, DeliveryZone

    n = _n()
    zone = DeliveryZone.objects.create(name=name or f"Zone {n}", slug=f"zone-{n}")
    if branch is not None:
        BranchDeliveryZone.objects.create(
            branch=branch,
            zone=zone,
            fee=Decimal(fee),
            min_order_total=Decimal(min_order),
            free_delivery_over=Decimal(free_over) if free_over else None,
        )
    return zone


def make_address(user, zone=None, **kw):
    from apps.accounts.models import Address

    return Address.objects.create(
        user=user,
        recipient_name=kw.pop("recipient_name", "Test Customer"),
        phone="+15550100",
        line1="5 Road",
        city="Testville",
        zone=zone,
        **kw,
    )


def make_category(name: str | None = None, **kw):
    from apps.catalog.models import Category

    n = _n()
    name = name or f"Category {n}"
    return Category.objects.create(name=name, slug=f"cat-{n}", **kw)


def make_product(name: str | None = None, price="4.00", category=None, *, stocked=False, **kw):
    from apps.catalog.models import Product

    n = _n()
    return Product.objects.create(
        category=category or make_category(),
        name=name or f"Product {n}",
        slug=f"product-{n}",
        sku=f"SKU-{n:05d}",
        base_price=Decimal(price),
        stock_mode="STOCKED" if stocked else "PREPARED",
        **kw,
    )


def make_modifier_group(
    product=None,
    name: str | None = None,
    *,
    required=False,
    multiple=False,
    min_select=None,
    max_select=None,
    options=(),
):
    """options: iterable of (name, price_delta[, is_default])."""
    from apps.catalog.models import ModifierGroup, ModifierOption, ProductModifierGroup

    n = _n()
    group = ModifierGroup.objects.create(
        name=name or f"Group {n}",
        display_name=name or f"Group {n}",
        selection_type="MULTIPLE" if multiple else "SINGLE",
        is_required=required,
        min_select=min_select if min_select is not None else (1 if required else 0),
        max_select=max_select if max_select is not None else (3 if multiple else 1),
    )
    created = []
    for i, opt in enumerate(options):
        created.append(
            ModifierOption.objects.create(
                group=group,
                name=opt[0],
                price_delta=Decimal(opt[1]),
                is_default=bool(opt[2]) if len(opt) > 2 else False,
                sort_order=i,
            )
        )
    if product is not None:
        ProductModifierGroup.objects.create(product=product, group=group)
    return group, created


def make_stock(branch, product, quantity=10, threshold=2):
    from apps.inventory.models import StockItem

    return StockItem.objects.create(branch=branch, product=product, quantity=quantity, low_stock_threshold=threshold)
