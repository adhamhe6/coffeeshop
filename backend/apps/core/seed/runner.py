# ruff: noqa: C408, S311  (seed definitions use dict(key=...) style; deterministic demo randomness is not security sensitive)
"""Orchestrates the demo seed. See docs/seed-data.md.

Policy (the command must be safe to run on a database that already holds real data):

* Rows the seed *owns* (products flagged ``is_demo``, demo orders/reviews, users on the ``lantern.example`` domain) are
  created or refreshed on every run.
* Everything else (categories, collections, branches, zones, coupons, pages, blocks, store settings...) is **created when
  missing and otherwise left alone**; pass ``--update-existing`` to refresh those rows from the seed definitions.
* A product whose slug already exists but is *not* flagged ``is_demo`` is never touched.
* ``--reset-demo`` deletes only flagged/demo rows before seeding again.
"""

from __future__ import annotations

import contextlib
import logging
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import ProtectedError
from django.utils import timezone

from . import catalog_data as cat
from . import content_data as cnt
from . import people_data as ppl
from . import places_data as plc
from .assets import attach_image

log = logging.getLogger(__name__)

DEFAULT_PASSWORD = "Lantern-demo-2026!"  # noqa: S105  (documented development-only demo password)


class DemoSeeder:
    def __init__(
        self,
        *,
        stdout=None,
        password: str = DEFAULT_PASSWORD,
        skip_images: bool = False,
        update_existing: bool = False,
        history: bool = True,
        now: datetime | None = None,
    ):
        self.out = stdout
        self.password = password
        self.skip_images = skip_images
        self.update_existing = update_existing
        self.with_history = history
        self.now = now or timezone.now()
        self.stats: Counter = Counter()
        self.warnings: list[str] = []
        self.branches: dict = {}
        self.zones: dict = {}
        self.categories: dict = {}
        self.groups: dict = {}
        self.products: dict = {}  # name -> Product (demo products only)
        self.users: dict = {}
        self.coupons: dict = {}

    # ------------------------------------------------------------------------------------------------- utilities
    def say(self, msg: str = "") -> None:
        if self.out:
            self.out.write(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        self.say(f"  ! {msg}")

    def _upsert(self, model, lookup: dict, defaults: dict, label: str, *, owned: bool = False):
        obj = model.objects.filter(**lookup).first()
        if obj is None:
            obj = model.objects.create(**lookup, **defaults)
            self.stats[f"{label}: created"] += 1
            return obj, True
        if owned or self.update_existing:
            changed = [k for k, v in defaults.items() if getattr(obj, k) != v]
            if changed:
                for k in changed:
                    setattr(obj, k, defaults[k])
                obj.save()
                self.stats[f"{label}: updated"] += 1
            else:
                self.stats[f"{label}: unchanged"] += 1
        else:
            self.stats[f"{label}: kept"] += 1
        return obj, False

    def _image(self, obj, field: str, group: str, name: str, *, replace: bool = False) -> None:
        if self.skip_images:
            return
        result = attach_image(obj, field, group, name, replace=replace or self.update_existing)
        if result == "missing":
            self.warn(f"image asset {group}/{name}.webp not found (run scripts/generate_assets.py)")
        self.stats[f"images {group}: {result}"] += 1

    # --------------------------------------------------------------------------------------------------- store
    def seed_settings(self) -> None:
        from apps.core.models import SocialProfile, StoreSettings

        s = StoreSettings.load()
        changed = False
        for key, value in cnt.STORE.items():
            field = s._meta.get_field(key)
            current = getattr(s, key)
            new = Decimal(value) if key == "tax_rate" else value
            default = field.get_default()
            # only fill fields that still hold the model default (or when asked to refresh)
            if (self.update_existing or current == default or current in ("", None)) and current != new:
                setattr(s, key, new)
                changed = True
        if changed:
            s.save()
            self.stats["store settings: updated"] += 1
        else:
            self.stats["store settings: kept"] += 1
        for platform, url, handle, order in cnt.SOCIAL:
            self._upsert(
                SocialProfile,
                {"platform": platform},
                dict(url=url, handle=handle, is_active=True, is_placeholder=True, sort_order=order),
                "social links",
            )

    def seed_content(self) -> None:
        from apps.core.models import Announcement, ContentBlock, ContentPage

        for page in cnt.PAGES:
            self._upsert(
                ContentPage,
                {"slug": page["slug"]},
                dict(title=page["title"], summary=page["summary"], body_markdown=page["body"], is_published=True),
                "content pages",
            )
        for blk in cnt.BLOCKS:
            obj, _ = self._upsert(
                ContentBlock,
                {"key": blk["key"]},
                dict(
                    eyebrow=blk["eyebrow"],
                    title=blk["title"],
                    body=blk["body"],
                    cta_label=blk["cta_label"],
                    cta_url=blk["cta_url"],
                    is_active=True,
                ),
                "content blocks",
            )
            if blk["image"]:
                self._image(obj, "image", "content", blk["image"])
        self._upsert(
            Announcement,
            {"message": cnt.ANNOUNCEMENT["message"]},
            dict(link_url=cnt.ANNOUNCEMENT["link_url"], is_active=True),
            "announcements",
        )
        if not self.skip_images:
            from apps.core.models import StoreSettings

            s = StoreSettings.load()
            self._image(s, "logo", "brand", "logo")

    # -------------------------------------------------------------------------------------------------- places
    def seed_places(self) -> None:
        from apps.branches.models import Branch, BranchClosure, BranchDeliveryZone, BranchHours, DeliveryZone

        for b in plc.BRANCHES:
            obj, created = self._upsert(
                Branch,
                {"code": b["code"]},
                dict(
                    name=b["name"],
                    slug=b["slug"],
                    description=b["description"],
                    address_line=b["address"],
                    city=b["city"],
                    postal_code=b["postal"],
                    latitude=Decimal(b["lat"]),
                    longitude=Decimal(b["lng"]),
                    phone=b["phone"],
                    email=b["email"],
                    timezone=plc.TIMEZONE,
                    is_active=True,
                    is_placeholder_address=True,
                    pickup_enabled=b["pickup"],
                    delivery_enabled=b["delivery"],
                    accepting_orders=True,
                    prep_minutes=b["prep"],
                    sort_order=b["sort"],
                ),
                "branches",
            )
            self.branches[b["code"]] = obj
            self._image(obj, "image", "branches", b["slug"])
            if created or self.update_existing:
                for wd, (opens, closes) in b["hours"].items():
                    BranchHours.objects.update_or_create(
                        branch=obj, weekday=wd, defaults=dict(opens=opens, closes=closes, is_closed=False)
                    )
        # one future holiday closure (4th Thursday of November)
        today = timezone.now().astimezone(ZoneInfo(plc.TIMEZONE)).date()
        year = today.year
        thanksgiving = _thanksgiving(year)
        if thanksgiving <= today:
            thanksgiving = _thanksgiving(year + 1)
        dt = self.branches["DT"]
        if not BranchClosure.objects.filter(branch=dt, start_date=thanksgiving).exists():
            BranchClosure.objects.create(
                branch=dt,
                start_date=thanksgiving,
                end_date=thanksgiving,
                reason="Closed for Thanksgiving Day (demo closure)",
            )
            self.stats["branch closures: created"] += 1
        else:
            self.stats["branch closures: kept"] += 1
        for name, slug, links in plc.ZONES:
            zone, _ = self._upsert(DeliveryZone, {"slug": slug}, dict(name=name, is_active=True), "delivery zones")
            self.zones[slug] = zone
            for code, (fee, minimum, free_over, eta) in links.items():
                self._upsert(
                    BranchDeliveryZone,
                    {"branch": self.branches[code], "zone": zone},
                    dict(
                        fee=fee, min_order_total=minimum, free_delivery_over=free_over, eta_minutes=eta, is_active=True
                    ),
                    "branch delivery zones",
                )

    # ------------------------------------------------------------------------------------------------- catalogue
    def seed_catalog(self) -> None:
        from apps.catalog.models import (
            Category,
            Collection,
            CollectionItem,
            ModifierGroup,
            ModifierOption,
            Product,
            ProductModifierGroup,
            Tag,
        )

        for c in cat.CATEGORIES:
            obj, _ = self._upsert(
                Category,
                {"slug": c["slug"]},
                dict(
                    name=c["name"],
                    description=c["description"],
                    sort_order=c["sort"],
                    is_active=True,
                    is_featured=c["featured"],
                ),
                "categories",
            )
            self.categories[c["slug"]] = obj
            self._image(obj, "image", "categories", c["slug"])
        tags = {}
        for name in cat.TAGS:
            tags[name], _ = Tag.objects.get_or_create(slug=cat.slugify(name), defaults={"name": name})
        for key, g in cat.MODIFIER_GROUPS.items():
            obj, created = self._upsert(
                ModifierGroup,
                {"name": g["name"]},
                dict(
                    display_name=g["display"],
                    selection_type=g["selection"],
                    is_required=g["required"],
                    min_select=g["min"],
                    max_select=g["max"],
                    sort_order=g["sort"],
                    is_active=True,
                ),
                "modifier groups",
            )
            self.groups[key] = obj
            for i, (oname, delta, default) in enumerate(g["options"]):
                self._upsert(
                    ModifierOption,
                    {"group": obj, "name": oname},
                    dict(
                        price_delta=Decimal(delta), is_default=default, is_active=True, is_available=True, sort_order=i
                    ),
                    "modifier options",
                )
        # products ---------------------------------------------------------------------------------------------
        for p in cat.PRODUCTS:
            slug = cat.slugify(p["name"])
            existing = Product.objects.filter(slug=slug).first() or Product.objects.filter(sku=p["sku"]).first()
            if existing is not None and not existing.is_demo:
                self.warn(f"product slug/sku '{slug}'/{p['sku']} already exists and is not demo data — left untouched")
                self.stats["products: skipped (non-demo clash)"] += 1
                continue
            flags = set(p["flags"].split(",")) if p["flags"] else set()
            nutrition = _nutrition(p)
            defaults = dict(
                category=self.categories[p["cat"]],
                name=p["name"],
                sku=p["sku"],
                product_type=p["type"],
                short_description=p["short"],
                description=p["desc"],
                base_price=p["price"],
                is_active=p["active"],
                is_featured="featured" in flags,
                is_bestseller="bestseller" in flags,
                is_seasonal="seasonal" in flags,
                is_new="new" in flags,
                is_sold_out=p["sold_out"],
                stock_mode=p["mode"],
                prep_minutes=p["prep"],
                calories=p["cal"],
                caffeine_mg=p["caf"],
                allergens=p["allergens"],
                nutrition=nutrition,
                sort_order=p["sort"],
                is_demo=True,
            )
            obj, _ = self._upsert(Product, {"slug": slug}, defaults, "products", owned=True)
            obj.tags.set([tags[t] for t in p["tags"] if t in tags])
            wanted = [self.groups[k] for k in p["groups"]]
            have = list(
                ProductModifierGroup.objects.filter(product=obj)
                .order_by("sort_order")
                .values_list("group_id", flat=True)
            )
            if have != [g.id for g in wanted]:
                ProductModifierGroup.objects.filter(product=obj).delete()
                ProductModifierGroup.objects.bulk_create(
                    [ProductModifierGroup(product=obj, group=g, sort_order=n * 10) for n, g in enumerate(wanted)]
                )
            self.products[p["name"]] = obj
            self._image(obj, "image", "products", slug, replace=True)
        # collections ------------------------------------------------------------------------------------------
        for col in cat.COLLECTIONS:
            obj, _ = self._upsert(
                Collection,
                {"slug": col["slug"]},
                dict(
                    name=col["name"],
                    description=col["description"],
                    is_active=True,
                    is_featured=col["featured"],
                    sort_order=col["sort"],
                ),
                "collections",
            )
            self._image(obj, "image", "collections", col["slug"])
            for n, pname in enumerate(col["products"]):
                prod = self.products.get(pname)
                if prod is None:
                    continue
                item, created = CollectionItem.objects.get_or_create(
                    collection=obj, product=prod, defaults={"sort_order": n * 10}
                )
                self.stats["collection items: created" if created else "collection items: kept"] += 1

    # --------------------------------------------------------------------------------------------------- stock
    STOCK_TARGETS = {  # (product name, branch) -> final quantity that demonstrates states
        ("Ethiopia Guji", "DT"): 3,
        ("Hand Burr Grinder", "RS"): 2,
        ("Kenya Nyeri", "RS"): 0,
        ("Costa Rica Honey", "DT"): 0,
        ("Costa Rica Honey", "RS"): 0,
        ("Costa Rica Honey", "AK"): 0,
    }
    AK_STOCK = {
        "Lantern House Blend",
        "Night Watch Espresso Blend",
        "Decaf Colombia",
        "Lantern Ceramic Mug",
        "Canvas Tote Bag",
        "Insulated Travel Tumbler",
        "Discovery Trio",
        "Ethiopia Guji",
    }

    def stocked_pairs(self):
        """(product, branch) pairs that carry stock rows."""
        for name, prod in self.products.items():
            if prod.stock_mode != "STOCKED" or not prod.is_active:
                continue
            for code, branch in self.branches.items():
                if code == "AK" and name not in self.AK_STOCK:
                    continue
                yield name, prod, code, branch

    def seed_stock(self) -> None:
        import random

        from apps.inventory.models import BranchProduct, InventoryMovement, StockItem

        rng = random.Random(7)
        for name, prod, code, branch in self.stocked_pairs():
            if code == "AK":
                qty = rng.randint(6, 20)
            else:
                qty = rng.randint(9, 60) if prod.product_type != "GIFT" else rng.randint(4, 14)
            qty = self.STOCK_TARGETS.get((name, code), qty)
            threshold = {"BEANS": 6, "MERCH": 3, "GIFT": 3}.get(prod.product_type, 5)
            item, created = StockItem.objects.get_or_create(
                branch=branch,
                product=prod,
                defaults=dict(
                    quantity=qty,
                    low_stock_threshold=threshold,
                    unit_cost=(prod.base_price * Decimal("0.42")).quantize(Decimal("0.01")),
                ),
            )
            if created:
                self.stats["stock items: created"] += 1
                if qty:
                    InventoryMovement.objects.create(
                        stock_item=item,
                        movement_type="INITIAL",
                        quantity_delta=qty,
                        quantity_after=qty,
                        reason="Initial stock (demo seed)",
                        reference="seed",
                    )
            else:
                self.stats["stock items: kept"] += 1
        # per-branch "not available today" toggles for prepared items
        for code, names in plc.BRANCH_UNAVAILABLE.items():
            for name in names:
                prod = self.products.get(name)
                if prod is None:
                    continue
                _, created = BranchProduct.objects.get_or_create(
                    branch=self.branches[code], product=prod, defaults={"is_available": False}
                )
                self.stats["branch availability: created" if created else "branch availability: kept"] += 1

    # ------------------------------------------------------------------------------------------------ promotions
    def seed_promotions(self) -> None:
        from apps.promotions.models import Coupon

        now = self.now
        cats = self.categories
        specs = [
            dict(
                code="WELCOME10",
                name="Welcome — 10% off your first order",
                description="DEMO coupon: 10% off your first order, minimum $8.",
                discount_type="PERCENT",
                value="10.00",
                min_order_total="8.00",
                applies_to="ALL",
                first_order_only=True,
                per_customer_limit=1,
            ),
            dict(
                code="AUTUMN15",
                name="Autumn favourites — 15% off Seasonal",
                description="DEMO coupon: 15% off Seasonal menu items, up to $6 off.",
                discount_type="PERCENT",
                value="15.00",
                max_discount="6.00",
                applies_to="CATEGORIES",
                cats=["seasonal"],
                starts_at=now - timedelta(days=14),
                ends_at=now + timedelta(days=45),
            ),
            dict(
                code="BEANS5",
                name="$5 off coffee beans over $30",
                description="DEMO coupon: $5 off coffee beans when you spend $30 or more on beans.",
                discount_type="FIXED",
                value="5.00",
                min_order_total="30.00",
                applies_to="CATEGORIES",
                cats=["coffee-beans"],
            ),
            dict(
                code="SUMMER24",
                name="Summer sip (expired)",
                description="DEMO coupon: an expired summer promotion, kept to show expiry handling.",
                discount_type="PERCENT",
                value="10.00",
                min_order_total="6.00",
                applies_to="ALL",
                starts_at=now - timedelta(days=135),
                ends_at=now - timedelta(days=45),
            ),
            dict(
                code="BAKERY3",
                name="$3 off pastries (fully redeemed)",
                description="DEMO coupon: $3 off pastries over $4 — usage limit reached, to show exhausted-code handling.",
                discount_type="FIXED",
                value="3.00",
                min_order_total="4.00",
                applies_to="CATEGORIES",
                cats=["pastries"],
                usage_limit=10,
                starts_at=now - timedelta(days=100),
            ),
            dict(
                code="HAPPYHOUR",
                name="Happy hour — 10% off Iced & Blended",
                description="DEMO automatic promotion: 10% off Iced & Blended drinks (applies automatically, no code needed).",
                discount_type="PERCENT",
                value="10.00",
                applies_to="CATEGORIES",
                cats=["iced-blended"],
                is_automatic=True,
                starts_at=now - timedelta(days=20),
            ),
        ]
        for s in specs:
            cats_ = s.pop("cats", [])
            for k in ("value", "max_discount", "min_order_total"):
                if k in s:
                    s[k] = Decimal(s[k])
            code = s.pop("code")
            existing = Coupon.objects.filter(code__iexact=code).first()
            if existing is None:
                obj = Coupon.objects.create(code=code, is_active=True, **s)
                self.stats["coupons: created"] += 1
            else:
                obj = existing
                if self.update_existing:
                    for k, v in s.items():
                        setattr(obj, k, v)
                    obj.save()
                    self.stats["coupons: updated"] += 1
                else:
                    self.stats["coupons: kept"] += 1
            if cats_ and (existing is None or self.update_existing):
                obj.categories.set([cats[c] for c in cats_])
            self.coupons[code] = obj

    # ---------------------------------------------------------------------------------------------------- people
    def seed_people(self) -> None:
        import random

        from apps.accounts.models import Address, StaffProfile
        from apps.catalog.models import Favorite
        from apps.core.models import NewsletterSubscriber

        User = get_user_model()
        rng = random.Random(11)

        def make_user(local, first, last, **extra):
            email = f"{local}@{ppl.DEMO_DOMAIN}"
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User.objects.create_user(
                    email=email,
                    password=self.password,
                    first_name=first,
                    last_name=last,
                    email_verified_at=timezone.now(),  # demo accounts receive order emails out of the box
                    **extra,
                )
                self.stats["demo users: created"] += 1
            else:
                dirty = False
                for k, v in dict(first_name=first, last_name=last, **extra).items():
                    if getattr(user, k) != v:
                        setattr(user, k, v)
                        dirty = True
                if not user.check_password(self.password):
                    user.set_password(self.password)
                    dirty = True
                if not user.is_active:
                    user.is_active = True
                    dirty = True
                if user.email_verified_at is None:
                    user.email_verified_at = timezone.now()
                    dirty = True
                if dirty:
                    user.save()
                    self.stats["demo users: updated"] += 1
                else:
                    self.stats["demo users: unchanged"] += 1
            self.users[local] = user
            return user

        for local, first, last, role, title, branch_codes in ppl.STAFF:
            extra = dict(is_staff=True, is_superuser=(role == "SUPER_ADMIN"))
            user = make_user(local, first, last, **extra)
            profile, _ = StaffProfile.objects.get_or_create(user=user, defaults=dict(role=role, job_title=title))
            if profile.role != role or profile.job_title != title:
                profile.role, profile.job_title = role, title
                profile.save()
            if branch_codes is not None:
                profile.branches.set([self.branches[c] for c in branch_codes])
        fav_pool = [p for p in self.products.values() if p.is_active and not p.is_sold_out]
        for local, first, last, phone, opt_in, addresses in ppl.CUSTOMERS:
            user = make_user(local, first, last, phone=phone, marketing_opt_in=opt_in)
            for n, (label, line1, line2, zone_slug, instr) in enumerate(addresses):
                Address.objects.update_or_create(
                    user=user,
                    label=label,
                    defaults=dict(
                        recipient_name=f"{first} {last}",
                        phone=phone,
                        line1=line1,
                        line2=line2,
                        city="Harbour City",
                        postal_code="00000 (placeholder)",
                        zone=self.zones[zone_slug],
                        instructions=instr,
                        is_default=(n == 0),
                        is_deleted=False,
                    ),
                )
            if not Favorite.objects.filter(user=user).exists():
                for prod in rng.sample(fav_pool, rng.randint(3, 6)):
                    Favorite.objects.get_or_create(user=user, product=prod)
                self.stats["favourites: created"] += 1
        for local in ppl.NEWSLETTER:
            NewsletterSubscriber.objects.get_or_create(email=f"{local}@{ppl.DEMO_DOMAIN}")

    # -------------------------------------------------------------------------------------------------- reset
    def reset_demo(self) -> None:
        """Delete ONLY demo rows: demo orders (+payments), demo reviews, products flagged is_demo and demo-domain users."""
        from apps.catalog.models import Product, Review
        from apps.core.models import NewsletterSubscriber
        from apps.orders.models import Order
        from apps.payments.models import Payment, Refund
        from apps.promotions.models import Coupon, CouponRedemption

        User = get_user_model()
        with transaction.atomic():
            orders = Order.objects.filter(is_demo=True)
            self.stats["reset: orders"] = orders.count()
            Refund.objects.filter(payment__order__is_demo=True).delete()
            Payment.objects.filter(order__is_demo=True).delete()
            orders.delete()
            self.stats["reset: reviews"] = Review.objects.filter(is_demo=True).count()
            Review.objects.filter(is_demo=True).delete()
            demo_products = list(Product.objects.filter(is_demo=True))
            for p in demo_products:
                if p.image:
                    with contextlib.suppress(OSError):
                        p.image.delete(save=False)
            self.stats["reset: products"] = len(demo_products)
            Product.objects.filter(is_demo=True).delete()
            n_users = 0
            for u in User.objects.filter(email__iendswith=f"@{ppl.DEMO_DOMAIN}"):
                try:
                    with transaction.atomic():
                        u.delete()
                    n_users += 1
                except ProtectedError:
                    self.warn(f"demo user {u.email} is referenced by non-demo orders — kept")
            self.stats["reset: users"] = n_users
            NewsletterSubscriber.objects.filter(email__iendswith=f"@{ppl.DEMO_DOMAIN}").delete()
            for coupon in Coupon.objects.all():
                real = CouponRedemption.objects.filter(coupon=coupon, is_voided=False).count()
                if coupon.times_redeemed != real:
                    Coupon.objects.filter(pk=coupon.pk).update(times_redeemed=real)
        self.users.clear()
        self.products.clear()

    # ------------------------------------------------------------------------------------------------------- run
    def run(self) -> None:
        with transaction.atomic():
            self.seed_settings()
            self.seed_content()
            self.seed_places()
            self.seed_catalog()
            self.seed_stock()
            self.seed_promotions()
            self.seed_people()
        if self.with_history:
            from .history import generate_history

            generate_history(self)
        try:
            from apps.core.cache import bump

            bump("catalog")
        except Exception:  # noqa: BLE001 - cache invalidation is best effort
            log.debug("catalog cache bump failed", exc_info=True)


def _thanksgiving(year: int) -> date:
    d = date(year, 11, 1)
    first_thursday = d + timedelta(days=(3 - d.weekday()) % 7)
    return first_thursday + timedelta(days=21)


def _nutrition(p: dict) -> dict:
    t = p["type"]
    if t == "BEVERAGE":
        return {"serving_size": "Small (8 fl oz) — values are estimates for the default recipe"}
    if t == "BEANS":
        return {"pack_size": "250 g (1 kg also available)", "form": "Whole bean"}
    if t == "FOOD":
        return {"serving_size": "1 portion — values are estimates"}
    return {}
