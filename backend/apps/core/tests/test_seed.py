"""seed_demo: idempotency, imagery, order invariants and --reset-demo safety."""

from __future__ import annotations

import hashlib
import io
import re
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

import pytest
from django.apps import apps
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.catalog.models import Category, Product, Review
from apps.core.models import StoreSettings
from apps.orders.models import Order

pytestmark = pytest.mark.django_db

COUNTED_MODELS = [
    "accounts.User",
    "accounts.StaffProfile",
    "accounts.Address",
    "core.SocialProfile",
    "core.ContentPage",
    "core.ContentBlock",
    "core.Announcement",
    "core.NewsletterSubscriber",
    "branches.Branch",
    "branches.BranchHours",
    "branches.BranchClosure",
    "branches.DeliveryZone",
    "branches.BranchDeliveryZone",
    "catalog.Category",
    "catalog.Product",
    "catalog.Tag",
    "catalog.ModifierGroup",
    "catalog.ModifierOption",
    "catalog.ProductModifierGroup",
    "catalog.Collection",
    "catalog.CollectionItem",
    "catalog.Favorite",
    "catalog.Review",
    "inventory.StockItem",
    "inventory.InventoryMovement",
    "inventory.BranchProduct",
    "promotions.Coupon",
    "promotions.CouponRedemption",
    "orders.Order",
    "orders.OrderItem",
    "orders.OrderItemOption",
    "orders.OrderStatusHistory",
    "orders.OrderNote",
    "payments.Payment",
    "payments.Refund",
    "notifications.Notification",
]
SETTLED = {"AUTHORIZED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"}


def q(v) -> Decimal:
    return Decimal(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def snapshot() -> dict:
    return {m: apps.get_model(m).objects.count() for m in COUNTED_MODELS}


def seed(*args) -> str:
    out = io.StringIO()
    call_command("seed_demo", *args, stdout=out)
    return out.getvalue()


@pytest.fixture(scope="module")
def media(tmp_path_factory):
    return tmp_path_factory.mktemp("media")


def _file_hash(field_file) -> str:
    with field_file.storage.open(field_file.name, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def test_seed_is_idempotent_complete_and_consistent(settings, media):
    settings.MEDIA_ROOT = media
    first_out = seed()
    assert "DEVELOPMENT ONLY" in first_out
    first = snapshot()
    numbers = set(Order.objects.values_list("number", flat=True))
    seed()
    second = snapshot()
    # (a) no duplicates, nothing grows on a re-run
    assert first == second
    assert set(Order.objects.values_list("number", flat=True)) == numbers
    assert Order.objects.filter(is_demo=True).count() >= 230
    assert Product.objects.filter(slug="latte").count() == 1

    # (b) catalogue size and images
    products = Product.objects.filter(is_demo=True)
    assert products.count() >= 55
    active = list(products.filter(is_active=True))
    assert len(active) >= 55
    hashes = {}
    for p in active:
        assert p.image and p.image.name, f"{p.slug} has no image"
        assert p.image.storage.exists(p.image.name), f"{p.slug} image file missing"
        h = _file_hash(p.image)
        assert h not in hashes, f"{p.slug} shares its image with {hashes[h]}"
        hashes[h] = p.slug
    for cat in Category.objects.all():
        assert cat.image and cat.image.storage.exists(cat.image.name)
    assert Product.objects.filter(is_demo=True, is_active=False).exists()  # archived demo item
    assert Product.objects.filter(is_demo=True, is_sold_out=True).exists()  # sold-out demo item
    store = StoreSettings.load()
    assert store.tax_rate == Decimal("8.00") and store.tax_label == "Sales tax (demo rate)"
    assert store.allowed_checkout_methods == ["stripe", "demo", "cash"]

    # (c) order invariants
    check_orders()
    check_stock_and_coupons()
    check_reviews()


def check_orders():
    from apps.orders.models import OrderItem  # noqa: F401

    rate = Decimal("8.00")
    pricing = None
    try:
        from apps.cart import pricing as pricing  # type: ignore[no-redef]  # noqa: PLC0415
    except Exception:  # pragma: no cover - the C1 module is optional for this test
        pricing = None
    orders = Order.objects.filter(is_demo=True).prefetch_related(
        "items__options", "payments__refunds", "history", "coupon_redemption"
    )
    today_active = 0
    now = timezone.now()
    for o in orders:
        assert re.fullmatch(r"(DT|RS|AK)-\d{6}-D\d{3}", o.number), o.number
        assert o.idempotency_key.startswith("seed-")
        items = list(o.items.all())
        assert items
        assert sum(i.line_total for i in items) == o.subtotal, o.number
        for i in items:
            assert i.unit_price == q(i.base_price + sum(opt.price_delta for opt in i.options.all()))
            assert i.line_total == q(i.unit_price * i.quantity)
        assert sum(i.discount_amount for i in items) == o.discount_total
        assert Decimal("0") <= o.discount_total <= o.subtotal
        assert o.total == o.subtotal - o.discount_total + o.delivery_fee + o.tax_total, o.number
        assert o.tax_total == q((o.subtotal - o.discount_total) * rate / 100)
        if pricing is not None:
            assert o.tax_total == pricing.compute_tax(o.subtotal - o.discount_total, rate, inclusive=False)
        assert o.refunded_total <= o.total
        payments = list(o.payments.all())
        settled = [p for p in payments if p.status in SETTLED]
        assert len(settled) <= 1, o.number
        refunds = [r for p in payments for r in p.refunds.all() if r.status == "SUCCEEDED"]
        assert sum((r.amount for r in refunds), Decimal("0")) == o.refunded_total
        counted = o.status != "CANCELLED" and (
            o.payment_status in ("PAID", "PARTIALLY_REFUNDED", "REFUNDED")
            or (o.payment_method == "cash" and o.status == "COMPLETED")
        )
        if counted:
            assert len(settled) == 1 and settled[0].status in ("PAID", "PARTIALLY_REFUNDED", "REFUNDED"), o.number
            assert settled[0].amount == o.total
        if o.payment_method in ("stripe", "demo"):
            assert all(p.is_sandbox for p in payments)
        assert all(p.reference.startswith("demo_seed_") for p in payments)
        if o.order_type == "DELIVERY":
            assert o.delivery_address and o.delivery_zone_name
        else:
            assert o.delivery_fee == 0
        hist = list(o.history.all())
        assert hist and hist[0].to_status == "PENDING" and hist[-1].to_status == o.status, o.number
        assert o.placed_at <= now
        if o.completed_at:
            assert o.completed_at >= o.placed_at
        if o.status == "CANCELLED":
            assert o.cancelled_at and o.cancel_reason
            redemption = getattr(o, "coupon_redemption", None)
            if o.coupon_id:
                assert redemption.is_voided
        if (
            o.status in ("PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY")
            and o.placed_at.date() >= (now - timedelta(days=1)).date()
        ):
            today_active += 1
    assert today_active >= 8, "the staff queue should not be empty"
    statuses = {o.status for o in orders}
    assert {
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "READY_FOR_PICKUP",
        "OUT_FOR_DELIVERY",
        "COMPLETED",
        "CANCELLED",
    } <= statuses
    assert orders.filter(payment_status="PARTIALLY_REFUNDED").exists()
    assert orders.filter(
        payments__status="FAILED", payment_status="PAID"
    ).exists()  # a failed attempt that later succeeded


def check_stock_and_coupons():
    from apps.inventory.models import StockItem
    from apps.promotions.models import Coupon, CouponRedemption

    for si in StockItem.objects.filter(product__is_demo=True):
        moves = list(si.movements.order_by("created_at", "id"))
        if not moves:
            assert si.quantity == 0  # a sold-out lot that never had stock recorded
            continue
        assert moves[0].movement_type == "INITIAL"
        assert si.quantity >= 0
        assert sum(m.quantity_delta for m in moves) == si.quantity, si
        assert moves[-1].quantity_after == si.quantity
        assert all(m.quantity_after >= 0 for m in moves)
    assert StockItem.objects.filter(product__is_demo=True, quantity=0).exists()
    assert any(si.is_low and si.quantity > 0 for si in StockItem.objects.filter(product__is_demo=True))
    for coupon in Coupon.objects.all():
        assert coupon.times_redeemed == CouponRedemption.objects.filter(coupon=coupon, is_voided=False).count()
    exhausted = Coupon.objects.get(code="BAKERY3")
    assert exhausted.usage_limit == exhausted.times_redeemed > 0
    assert Coupon.objects.get(code="HAPPYHOUR").is_automatic
    assert Coupon.objects.get(code="SUMMER24").ends_at < timezone.now()


def check_reviews():
    reviews = Review.objects.filter(is_demo=True)
    assert reviews.count() >= 20
    assert reviews.filter(status="PENDING").exists() and reviews.filter(status="APPROVED").exists()
    for r in reviews:
        assert r.order_id and r.order.status == "COMPLETED" and r.order.customer_id == r.user_id
        assert r.order.items.filter(product=r.product).exists()


def test_reset_demo_only_removes_demo_rows(settings, media):
    from apps.accounts.models import User

    settings.MEDIA_ROOT = media
    seed("--no-history")
    cat = Category.objects.get(slug="espresso")
    manual = Product.objects.create(
        category=cat, name="Manual Test Brew", slug="manual-test-brew", sku="MAN-0001", base_price=Decimal("9.99")
    )
    real_user = User.objects.create_user(email="owner@example.com", password="x-Strong-pass-1")
    manual_order_customer = real_user
    assert Product.objects.filter(is_demo=True).count() >= 55
    assert User.objects.filter(email__endswith="@lantern.example").count() == 14
    seed("--no-history", "--reset-demo")
    manual.refresh_from_db()
    assert manual.name == "Manual Test Brew" and manual.is_demo is False
    assert User.objects.filter(email="owner@example.com").exists() and manual_order_customer.pk
    assert Product.objects.filter(is_demo=True).count() >= 55  # re-seeded
    assert Product.objects.filter(slug="manual-test-brew").count() == 1
    # a second, full run on top keeps the manual row too
    seed("--reset-demo")
    assert Product.objects.filter(slug="manual-test-brew", is_demo=False).count() == 1
    assert Order.objects.filter(is_demo=True).count() >= 230
    assert not Order.objects.filter(is_demo=False).exists()


def test_existing_non_demo_product_with_same_slug_is_never_overwritten(settings, media):
    settings.MEDIA_ROOT = media
    cat = Category.objects.create(name="Mine", slug="mine")
    mine = Product.objects.create(
        category=cat, name="My Own Latte", slug="latte", sku="MINE-1", base_price=Decimal("1.23")
    )
    out = seed("--no-history")
    mine.refresh_from_db()
    assert mine.name == "My Own Latte" and mine.base_price == Decimal("1.23") and mine.is_demo is False
    assert "left untouched" in out


def test_refuses_production_like_settings(settings):
    settings.DEBUG = False
    settings.SETTINGS_MODULE = "config.settings.prod"
    with pytest.raises(CommandError, match="Refusing"):
        seed("--no-history", "--skip-images")
    # explicit override works (images skipped to keep the test light)
    settings.MEDIA_ROOT = "/tmp/lantern-seed-test-media"
    out = seed("--no-history", "--skip-images", "--allow-production")
    assert "DEMO DATA" in out
