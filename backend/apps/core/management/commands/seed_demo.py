"""``manage.py seed_demo`` — idempotent demo data (catalogue, imagery, content, branches, people, order history).

DEVELOPMENT / DEMO ONLY. See docs/seed-data.md for what is created and which values are placeholders.
"""

from __future__ import annotations

import os

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.core.seed.runner import DEFAULT_PASSWORD, DemoSeeder

SUMMARY = [
    ("accounts.User", "Users"),
    ("accounts.StaffProfile", "Staff profiles"),
    ("accounts.Address", "Addresses"),
    ("core.StoreSettings", "Store settings"),
    ("core.SocialProfile", "Social profiles"),
    ("core.ContentPage", "Content pages"),
    ("core.ContentBlock", "Content blocks"),
    ("core.Announcement", "Announcements"),
    ("core.NewsletterSubscriber", "Newsletter subscribers"),
    ("branches.Branch", "Branches"),
    ("branches.BranchHours", "Branch hours"),
    ("branches.BranchClosure", "Branch closures"),
    ("branches.DeliveryZone", "Delivery zones"),
    ("branches.BranchDeliveryZone", "Branch/zone links"),
    ("catalog.Category", "Categories"),
    ("catalog.Product", "Products"),
    ("catalog.Tag", "Tags"),
    ("catalog.ModifierGroup", "Modifier groups"),
    ("catalog.ModifierOption", "Modifier options"),
    ("catalog.Collection", "Collections"),
    ("catalog.Favorite", "Favourites"),
    ("catalog.Review", "Reviews"),
    ("inventory.StockItem", "Stock items"),
    ("inventory.InventoryMovement", "Stock movements"),
    ("inventory.BranchProduct", "Branch availability rows"),
    ("promotions.Coupon", "Coupons / promotions"),
    ("promotions.CouponRedemption", "Coupon redemptions"),
    ("orders.Order", "Orders"),
    ("orders.OrderItem", "Order items"),
    ("orders.OrderStatusHistory", "Status history rows"),
    ("payments.Payment", "Payments"),
    ("payments.Refund", "Refunds"),
    ("notifications.Notification", "Notifications"),
]


class Command(BaseCommand):
    help = "Seed idempotent DEMO data (development only). Safe to re-run; never touches non-demo rows."

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-history", action="store_true", help="Skip the ~240 demonstration orders (and reviews/notifications)."
        )
        parser.add_argument(
            "--reset-demo",
            action="store_true",
            help="Delete ONLY demo rows (is_demo products/orders/reviews, @lantern.example users) then re-seed.",
        )
        parser.add_argument(
            "--skip-images", action="store_true", help="Do not copy the generated illustrations into media storage."
        )
        parser.add_argument(
            "--password",
            default=None,
            help="Password for demo users (default: env DEMO_PASSWORD, else the documented dev password).",
        )
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help="Run even though the settings look production-like (DEBUG off). Almost never what you want.",
        )
        parser.add_argument(
            "--update-existing",
            action="store_true",
            help="Also refresh non-demo seed-defined rows (categories, branches, pages...) that already exist.",
        )

    def handle(self, *args, **opts):
        module = getattr(settings, "SETTINGS_MODULE", None) or os.environ.get("DJANGO_SETTINGS_MODULE", "")
        production_like = (not settings.DEBUG) and not module.endswith(".test")
        if production_like and not opts["allow_production"]:
            raise CommandError(
                f"Refusing to seed demo data: settings module '{module}' has DEBUG off and is not the test settings. "
                "Demo data includes well-known development passwords. Re-run with --allow-production only if you are sure."
            )
        password = opts["password"] or os.environ.get("DEMO_PASSWORD") or DEFAULT_PASSWORD
        bar = "!" * 78
        self.stdout.write(self.style.WARNING(bar))
        self.stdout.write(
            self.style.WARNING(
                "  DEMO DATA — DEVELOPMENT ONLY. Demo accounts (*@lantern.example) share a well-known password."
            )
        )
        self.stdout.write(
            self.style.WARNING(
                "  Never run this against a real store. Tax rate, addresses, social links and legal pages are placeholders."
            )
        )
        self.stdout.write(self.style.WARNING(bar))
        seeder = DemoSeeder(
            stdout=self.stdout,
            password=password,
            skip_images=opts["skip_images"],
            update_existing=opts["update_existing"],
            history=not opts["no_history"],
        )
        if opts["reset_demo"]:
            self.stdout.write("Resetting demo rows ...")
            seeder.reset_demo()
        seeder.run()
        self.print_summary(seeder)

    def print_summary(self, seeder):
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Seed complete. Row counts:"))
        width = max(len(label) for _, label in SUMMARY)
        for model, label in SUMMARY:
            try:
                n = apps.get_model(model).objects.count()
            except LookupError:
                continue
            self.stdout.write(f"  {label:<{width}}  {n:>6}")
        interesting = {k: v for k, v in sorted(seeder.stats.items()) if not k.startswith("images")}
        if interesting:
            self.stdout.write("")
            self.stdout.write("This run:")
            for k, v in interesting.items():
                self.stdout.write(f"  {k}: {v}")
        imgs = {k: v for k, v in sorted(seeder.stats.items()) if k.startswith("images")}
        if imgs:
            self.stdout.write("  " + ", ".join(f"{k} {v}" for k, v in imgs.items()))
        for w in seeder.warnings:
            self.stdout.write(self.style.WARNING(f"warning: {w}"))
        self.stdout.write("")
        self.stdout.write(
            "Log in at the storefront with customer@lantern.example or any staff address from docs/seed-data.md."
        )
