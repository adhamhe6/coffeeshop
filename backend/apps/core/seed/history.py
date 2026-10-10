# ruff: noqa: S311  (seeded, deterministic demo data - not security sensitive)
"""Demonstration order history (~240 orders over the last 90 days), reviews, notifications and the stock ledger.

Deterministic (``random.Random(42)``), anchored on "now" so dashboards look current, and priced with the plan section 5
formula so every constraint/invariant holds:

    unit = base + sum(option deltas); line = unit x qty; subtotal = sum(line)
    discount = typed coupon OR best automatic promotion on eligible lines (percent/fixed, max_discount, never > eligible)
    delivery fee = zone fee (free over threshold; 0 for pickup);   tax = rate% x (subtotal - discount), delivery untaxed
    total = subtotal - discount + delivery_fee + tax          (every component rounded half-up to cents)

Demo orders carry ``is_demo=True`` and numbers like ``DT-261010-D007`` (the ``D`` keeps them clear of live numbers).
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from django.db import transaction

from . import people_data as ppl
from . import places_data as plc

TWO = Decimal("0.01")
ZERO = Decimal("0.00")
N_TOTAL = 240
N_TODAY = 12
BAKERY_LIMIT = 10  # the 'exhausted' demo coupon: usage_limit == redemptions
UTC = ZoneInfo("UTC")


def q(v) -> Decimal:
    return Decimal(v).quantize(TWO, rounding=ROUND_HALF_UP)


def distribute(amount: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Largest-remainder split in whole cents (same algorithm as apps.cart.pricing.distribute)."""
    cents = int((q(amount) * 100).to_integral_value())
    w = [int((q(x) * 100).to_integral_value()) for x in weights]
    total_w = sum(w)
    if cents <= 0 or total_w <= 0:
        return [ZERO for _ in weights]
    base = [cents * x // total_w for x in w]
    rem = [cents * x % total_w for x in w]
    left = cents - sum(base)
    for i in sorted(range(len(w)), key=lambda i: (-rem[i], i))[:left]:
        base[i] += 1
    return [Decimal(b) / 100 for b in base]


# ------------------------------------------------------------------------------------------------------ data classes


@dataclass
class Line:
    product: object
    options: list  # list of ModifierOption
    qty: int
    note: str = ""
    unit: Decimal = ZERO
    total: Decimal = ZERO
    discount: Decimal = ZERO


@dataclass
class Plan:
    n: int = 0
    branch: object = None
    code: str = ""
    customer: object = None
    order_type: str = "PICKUP"
    method: str = "stripe"
    scenario: str = "completed"  # completed | cust_cancel | staff_cancel | abandoned | active:<STATUS>
    placed: datetime = None
    lines: list = field(default_factory=list)
    address: object = None
    terms: tuple = None  # (fee, min, free_over, eta)
    coupon: object = None
    discount: Decimal = ZERO
    subtotal: Decimal = ZERO
    delivery_fee: Decimal = ZERO
    tax: Decimal = ZERO
    total: Decimal = ZERO
    failed_first: bool = False
    refund: str = ""  # "" | partial | full
    requested_for: datetime = None
    notes: str = ""
    number: str = ""
    events: list = field(default_factory=list)  # (status, at, user, label, note)
    paid_at: datetime = None
    completed_at: datetime = None
    cancelled_at: datetime = None
    confirmed_at: datetime = None
    ready_at: datetime = None
    refund_at: datetime = None
    refund_amount: Decimal = ZERO
    final_status: str = "COMPLETED"
    payment_status: str = "PAID"
    updated_at: datetime = None


HOUR_WEIGHTS = {6: 3, 7: 8, 8: 11, 9: 9, 10: 6, 11: 5, 12: 9, 13: 8, 14: 5, 15: 4, 16: 4, 17: 5, 18: 4, 19: 2, 20: 1}
NOTES = [
    "Extra napkins please",
    "Name on the cup: Alex",
    "Please leave at the door",
    "Oat milk if possible",
    "Allergy: no nuts please",
    "Quick as you can, thanks",
    "Ring the bell, please",
    "Extra hot",
]
LINE_NOTES = ["extra hot", "light foam", "no sugar please", "cut in half", "well done"]
REFUND_REASONS = [
    "Drink arrived cold (goodwill refund)",
    "Missing item refunded",
    "Wrong item prepared",
    "Order delayed (goodwill refund)",
]
STAFF_CANCEL_REASONS = [
    "Item unavailable at this location",
    "Out of oat milk — customer contacted and agreed to cancel",
    "Kitchen closed early (demo)",
]


class HistoryBuilder:
    def __init__(self, seeder):
        self.s = seeder
        self.rng = random.Random(42)
        self.tz = ZoneInfo(plc.TIMEZONE)
        self.now = seeder.now
        self.today = self.now.astimezone(self.tz).date()
        self.branch_cfg = {b["code"]: b for b in plc.BRANCHES}

    # -------------------------------------------------------------------------------------------------- context
    def load(self):
        from apps.accounts.models import Address
        from apps.branches.models import BranchDeliveryZone
        from apps.catalog.models import ModifierGroup
        from apps.inventory.models import BranchProduct, StockItem

        s = self.s
        self.products = dict(s.products)
        self.opts = {}
        for p in self.products.values():
            groups = []
            for link in p.modifier_links.select_related("group").order_by("sort_order"):
                g = link.group
                groups.append((g, list(g.options.filter(is_active=True).order_by("sort_order"))))
            self.opts[p.id] = groups
        _ = ModifierGroup
        self.unavail = {(bp.branch_id, bp.product_id) for bp in BranchProduct.objects.filter(is_available=False)}
        self.stocked = {(si.branch_id, si.product_id) for si in StockItem.objects.filter(product__is_demo=True)}
        self.customers = [s.users[c[0]] for c in ppl.CUSTOMERS]
        self.addresses = {
            u.id: list(Address.objects.filter(user=u, is_deleted=False).select_related("zone")) for u in self.customers
        }
        self.links = {}
        for link in BranchDeliveryZone.objects.filter(is_active=True).select_related("zone", "branch"):
            self.links[(link.branch.code, link.zone_id)] = (
                link.fee,
                link.min_order_total,
                link.free_delivery_over,
                link.eta_minutes,
            )
        self.coupons = s.coupons
        self.staff_pick = {
            "DT": [s.users["branchmanager.downtown"], s.users["ordermanager"]],
            "RS": [s.users["ordermanager"]],
            "AK": [s.users["admin"]],
        }
        self.by_type = defaultdict(list)
        for p in self.products.values():
            self.by_type[p.product_type].append(p)
        self.cat_ids = {slug: c.id for slug, c in s.categories.items()}
        self.coupon_cats = {code: {c.id for c in cp.categories.all()} for code, cp in self.coupons.items()}

    # ------------------------------------------------------------------------------------------------ sampling
    def local(self, day, hour, minute, second=0):
        return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=self.tz).astimezone(UTC)

    def hours(self, code, day):
        o, c = self.branch_cfg[code]["hours"][day.weekday()]
        return o, c

    def sample_time(self, code, day):
        o, c = self.hours(code, day)
        hs = [h for h in HOUR_WEIGHTS if o.hour <= h < c.hour]
        h = self.rng.choices(hs, [HOUR_WEIGHTS[x] for x in hs])[0]
        minute = self.rng.randint(0, 59)
        if h == o.hour:
            minute = max(minute, o.minute)
        if h == c.hour - 1:
            minute = min(minute, 45)
        return self.local(day, h, minute, self.rng.randint(0, 59))

    def pick_product(self, branch, when, age_days, cart_hour):
        rng = self.rng
        kind = rng.choices(["BEVERAGE", "FOOD", "BEANS", "MERCH", "GIFT"], [62, 26, 7, 3, 2])[0]
        pool = []
        for p in self.by_type[kind]:
            if (branch.id, p.id) in self.unavail:
                continue
            if p.stock_mode == "STOCKED" and (branch.id, p.id) not in self.stocked:
                continue
            if p.is_seasonal and p.is_active and age_days > 21:
                continue
            if p.is_new and p.is_active and age_days > 45:
                continue
            if not p.is_active:
                if p.name.startswith("Summer Peach") and age_days > 45:
                    pass  # retired summer special: only older orders
                else:
                    continue
            if p.is_sold_out and age_days < 12:
                continue
            if p.is_sold_out and not p.is_active:
                continue
            w = 1.0
            if p.is_bestseller:
                w *= 3
            if p.is_featured:
                w *= 1.6
            if p.category.slug == "pastries" and cart_hour < 11:
                w *= 1.6
            if p.category.slug in ("iced-blended", "filter-cold-brew") and 12 <= cart_hour <= 17:
                w *= 1.4
            pool.append((p, w))
        if not pool:
            return None
        return rng.choices([p for p, _ in pool], [w for _, w in pool])[0]

    def choose_options(self, product):
        rng = self.rng
        chosen = []
        for g, options in self.opts[product.id]:
            n = g.name
            by_name = {o.name: o for o in options}
            pick = []
            if n == "Size (drinks)":
                pick = [by_name[rng.choices(["Small", "Medium", "Large"], [45, 38, 17])[0]]]
            elif n == "Size (espresso)":
                pick = [by_name[rng.choices(["Single", "Double"], [70, 30])[0]]]
            elif n == "Temperature":
                pick = [by_name[rng.choices(["Hot", "Iced"], [80, 20])[0]]]
            elif n == "Bag size":
                pick = [by_name[rng.choices(["250 g", "1 kg"], [92, 8])[0]]]
            elif n == "Grind":
                pick = [by_name[rng.choices(["Whole bean", "Filter", "Espresso", "French press"], [50, 25, 15, 10])[0]]]
            elif n == "Milk" and rng.random() < 0.65:
                pick = [
                    by_name[
                        rng.choices(
                            ["Whole milk", "Skim milk", "Oat milk", "Almond milk", "Soy milk"], [40, 8, 28, 12, 12]
                        )[0]
                    ]
                ]
            elif n == "Extra shot" and rng.random() < 0.10:
                pick = rng.sample(options, 2 if rng.random() < 0.15 else 1)
            elif n == "Syrup" and rng.random() < 0.14:
                pick = rng.sample(options, 2 if rng.random() < 0.12 else 1)
            elif n == "Sweetness" and rng.random() < 0.08:
                pick = [by_name[rng.choice(["No sugar", "Light", "Extra"])]]
            elif n == "Toppings" and rng.random() < 0.22:
                pick = rng.sample(options, 2 if rng.random() < 0.2 else 1)
            elif n == "Decaf swap" and rng.random() < 0.06:
                pick = options[:1]
            elif n == "Ice level" and rng.random() < 0.20:
                pick = [by_name[rng.choice(["Light ice", "No ice"])]]
            elif n == "Food extras" and rng.random() < 0.12:
                pick = rng.sample(options, 1)
            if g.max_select < len(pick):
                pick = pick[: g.max_select]
            chosen.extend(pick)
        return chosen

    def make_lines(self, branch, when, age_days, count):
        lines = []
        used = set()
        local_hour = when.astimezone(self.tz).hour
        for _ in range(count):
            p = None
            for _try in range(6):
                cand = self.pick_product(branch, when, age_days, local_hour)
                if cand is not None and cand.id not in used:
                    p = cand
                    break
            if p is None:
                continue
            used.add(p.id)
            qty = self.rng.choices([1, 2, 3], [80, 17, 3])[0]
            if p.stock_mode == "STOCKED" and qty > 1 and p.product_type != "BEANS":
                qty = 1
            note = self.rng.choice(LINE_NOTES) if p.product_type == "BEVERAGE" and self.rng.random() < 0.05 else ""
            lines.append(Line(p, self.choose_options(p), qty, note))
        return lines

    # ------------------------------------------------------------------------------------------------- pricing
    def price(self, plan: Plan):
        rate = Decimal("8.00")
        for ln in plan.lines:
            ln.unit = q(ln.product.base_price + sum((o.price_delta for o in ln.options), ZERO))
            ln.total = q(ln.unit * ln.qty)
            ln.discount = ZERO
        plan.subtotal = sum((ln.total for ln in plan.lines), ZERO)
        plan.coupon, plan.discount = self.pick_coupon(plan)
        plan.delivery_fee = ZERO
        if plan.order_type == "DELIVERY":
            fee, _minimum, free_over, _eta = plan.terms
            plan.delivery_fee = ZERO if (free_over is not None and plan.subtotal >= free_over) else q(fee)
        taxable = plan.subtotal - plan.discount
        plan.tax = q(taxable * rate / 100) if taxable > 0 else ZERO
        plan.total = q(taxable + plan.delivery_fee + plan.tax)

    def evaluate(self, coupon, plan: Plan, when):
        """Return the discount for ``coupon`` at ``when`` or None when it would be rejected (mirrors apps.cart.pricing)."""
        if not coupon.is_active:
            return None
        if coupon.starts_at and coupon.starts_at > when:
            return None
        if coupon.ends_at and coupon.ends_at <= when:
            return None
        if coupon.applies_to == "CATEGORIES":
            ids = self.coupon_cats[coupon.code]
            idx = [i for i, ln in enumerate(plan.lines) if ln.product.category_id in ids]
        else:
            idx = list(range(len(plan.lines)))
        eligible = sum((plan.lines[i].total for i in idx), ZERO)
        if not idx or eligible <= 0 or eligible < q(coupon.min_order_total):
            return None
        value = (
            q(eligible * min(coupon.value, Decimal(100)) / 100)
            if coupon.discount_type == "PERCENT"
            else q(coupon.value)
        )
        if coupon.max_discount is not None:
            value = min(value, q(coupon.max_discount))
        value = max(min(value, eligible), ZERO)
        if value <= 0:
            return None
        parts = distribute(value, [plan.lines[i].total for i in idx])
        return value, dict(zip(idx, parts, strict=True))

    def pick_coupon(self, plan: Plan):
        rng = self.rng
        when = plan.placed
        c = self.coupons
        typed = None
        first = plan.customer.id not in self.seen_customers
        order = []
        if first and rng.random() < 0.55:
            order.append("WELCOME10")
        if rng.random() < 0.35:
            order.append("AUTUMN15")
        if rng.random() < 0.40:
            order.append("BEANS5")
        has_pastry = any(ln.product.category.slug == "pastries" for ln in plan.lines)
        if has_pastry and self.bakery_used < BAKERY_LIMIT and rng.random() < 0.7:
            order.insert(0, "BAKERY3")
        if rng.random() < 0.15:
            order.append("SUMMER24")
        for code in order:
            res = self.evaluate(c[code], plan, when)
            if res is not None:
                typed = (c[code], res)
                break
        if typed is None:
            best = None
            for code in ("HAPPYHOUR",):
                res = self.evaluate(c[code], plan, when)
                if res is not None and (best is None or res[0] > best[1][0]):
                    best = (c[code], res)
            typed = best
        if typed is None:
            return None, ZERO
        coupon, (value, alloc) = typed
        for i, amount in alloc.items():
            plan.lines[i].discount = amount
        return coupon, value

    # ------------------------------------------------------------------------------------------------- planning
    def build_plans(self):
        rng = self.rng
        s = self.s
        days = [self.today - timedelta(days=i) for i in range(89, 0, -1)]
        weights = []
        for i, d in enumerate(days):
            w = 0.8 + 0.4 * i / len(days)
            if d.weekday() >= 5:
                w *= 1.5
            elif d.weekday() == 4:
                w *= 1.15
            weights.append(w * rng.uniform(0.8, 1.2))
        past_days = rng.choices(days, weights, k=N_TOTAL - N_TODAY)
        plans: list[Plan] = []
        codes = ["DT", "RS", "AK"]
        cweights = [45, 35, 20]
        cust_w = [20, 17, 15, 18, 14, 16]
        for day in past_days:
            p = Plan()
            p.code = rng.choices(codes, cweights)[0]
            p.branch = s.branches[p.code]
            p.placed = self.sample_time(p.code, day)
            r = rng.random()
            p.scenario = (
                "cust_cancel" if r < 0.04 else "staff_cancel" if r < 0.065 else "abandoned" if r < 0.1 else "completed"
            )
            plans.append(p)
        # today's live queue
        today_status = [
            "PENDING",
            "PENDING",
            "CONFIRMED",
            "CONFIRMED",
            "PREPARING",
            "PREPARING",
            "PREPARING",
            "READY_FOR_PICKUP",
            "READY_FOR_PICKUP",
            "OUT_FOR_DELIVERY",
            "COMPLETED",
            "COMPLETED",
        ]
        minutes_since_midnight = int((self.now - self.local(self.today, 0, 0)).total_seconds() // 60)
        for st in today_status:
            p = Plan()
            p.code = rng.choice(["DT", "DT", "RS"]) if st != "OUT_FOR_DELIVERY" else rng.choice(["DT", "RS"])
            p.branch = s.branches[p.code]
            back = {
                "PENDING": (1, 6),
                "CONFIRMED": (6, 14),
                "PREPARING": (9, 22),
                "READY_FOR_PICKUP": (14, 32),
                "OUT_FOR_DELIVERY": (22, 42),
                "COMPLETED": (70, 200),
            }[st]
            delta = min(rng.randint(*back), max(minutes_since_midnight - 1, 1))
            p.placed = self.now - timedelta(minutes=delta, seconds=rng.randint(0, 40))
            p.scenario = f"active:{st}"
            plans.append(p)
        plans.sort(key=lambda p: p.placed)
        # method / type / customer
        for i, p in enumerate(plans, start=1):
            p.n = i
            p.method = rng.choices(["stripe", "demo", "cash"], [45, 25, 30])[0]
            if p.scenario in ("cust_cancel", "staff_cancel", "abandoned") and p.method == "cash":
                p.method = rng.choice(["stripe", "demo"])
            if p.scenario == "active:PENDING" and i % 2:
                p.method = "demo"
            p.customer = rng.choices(self.customers, cust_w)[0]
            wants_delivery = rng.random() < 0.26 or p.scenario == "active:OUT_FOR_DELIVERY"
            p.order_type = "DELIVERY" if (wants_delivery and p.branch.delivery_enabled) else "PICKUP"
            if p.scenario == "active:READY_FOR_PICKUP":
                p.order_type = "PICKUP"
            if p.scenario == "active:OUT_FOR_DELIVERY":
                p.order_type = "DELIVERY"
        return plans

    def finish_plan(self, p: Plan) -> bool:
        """Choose address/lines, price, and schedule timestamps. Returns False when the plan cannot be satisfied."""
        rng = self.rng
        age_days = (self.now - p.placed).days
        if p.order_type == "DELIVERY":
            options = [a for a in self.addresses[p.customer.id] if (p.code, a.zone_id) in self.links]
            if not options and p.scenario == "active:OUT_FOR_DELIVERY":
                for (
                    cust
                ) in self.customers:  # the live delivery must be deliverable: pick a customer served by this branch
                    options = [a for a in self.addresses[cust.id] if (p.code, a.zone_id) in self.links]
                    if options:
                        p.customer = cust
                        break
            if not options:
                if p.scenario == "active:OUT_FOR_DELIVERY":
                    return False
                p.order_type = "PICKUP"
            else:
                p.address = rng.choice(options)
                p.terms = self.links[(p.code, p.address.zone_id)]
        count = rng.choices([1, 2, 3, 4, 5], [34, 34, 17, 10, 5])[0] + (1 if p.order_type == "DELIVERY" else 0)
        p.lines = self.make_lines(p.branch, p.placed, age_days, count)
        if not p.lines:
            return False
        if p.order_type == "DELIVERY":
            subtotal = sum((q(ln_.product.base_price) * ln_.qty for ln_ in p.lines), ZERO)
            tries = 0
            while subtotal < p.terms[1] and tries < 4:
                extra = self.make_lines(p.branch, p.placed, age_days, 1)
                have = {ln_.product.id for ln_ in p.lines}
                p.lines.extend([x for x in extra if x.product.id not in have])
                subtotal = sum((q(ln_.product.base_price) * ln_.qty for ln_ in p.lines), ZERO)
                tries += 1
            if subtotal < p.terms[1]:
                p.order_type, p.address, p.terms = "PICKUP", None, None
        self.price(p)
        self.seen_customers.add(p.customer.id)
        if p.coupon is not None and p.coupon.code == "BAKERY3":
            self.bakery_used += 1
        return True

    # ------------------------------------------------------------------------------------------------ timelines
    def timeline(self, p: Plan):
        rng = self.rng
        online = p.method != "cash"
        staff = rng.choice(self.staff_pick[p.code])
        label = staff.full_name
        placed = p.placed
        prep = timedelta(
            minutes=p.branch.prep_minutes + max(ln_.product.prep_minutes for ln_ in p.lines) + rng.randint(-2, 4)
        )
        delivery = p.order_type == "DELIVERY"
        eta = timedelta(minutes=p.terms[3] + rng.randint(-4, 8)) if delivery else timedelta(0)
        sc = p.scenario
        ev = [("PENDING", placed, None, "customer", "Order placed")]
        if online:
            p.paid_at = placed + timedelta(seconds=rng.randint(25, 95))
        if sc.startswith("active:"):
            st = sc.split(":")[1]
            p.final_status = st
            t = placed
            if st == "PENDING":
                p.paid_at = None
                p.payment_status = "REQUIRES_ACTION" if p.method == "demo" else "PENDING"
                p.events = ev
                return
            t = max(t + timedelta(minutes=rng.randint(1, 3)), (p.paid_at or t) + timedelta(seconds=20))
            ev.append(("CONFIRMED", t, staff, label, ""))
            p.confirmed_at = t
            if st != "CONFIRMED":
                t += timedelta(minutes=rng.randint(1, 3))
                ev.append(("PREPARING", t, staff, label, ""))
                if st in ("READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "COMPLETED"):
                    t += prep
                    nxt = "OUT_FOR_DELIVERY" if delivery else "READY_FOR_PICKUP"
                    ev.append((nxt, t, staff, label, ""))
                    p.ready_at = t
                    if st == "COMPLETED":
                        t += eta if delivery else timedelta(minutes=rng.randint(2, 12))
                        ev.append(("COMPLETED", t, staff, label, ""))
                        p.completed_at = t
            # never schedule an event in the future
            ev = [(a, min(b, self.now - timedelta(seconds=5)), c, d, e) for a, b, c, d, e in ev]
            p.events = ev
            p.payment_status = "PAID" if online else ("PAID" if st == "COMPLETED" else "PENDING")
            if not online and st == "COMPLETED":
                p.paid_at = p.completed_at
            return
        if rng.random() < 0.15 and sc == "completed":
            p.requested_for = placed + timedelta(minutes=rng.randint(45, 150))
            o, c = self.hours(p.code, placed.astimezone(self.tz).date())
            close = self.local(placed.astimezone(self.tz).date(), c.hour, c.minute)
            if p.requested_for > close - timedelta(minutes=15):
                p.requested_for = None
        if sc == "abandoned":
            p.paid_at = None
            p.cancelled_at = placed + timedelta(minutes=30)
            ev.append(("CANCELLED", p.cancelled_at, None, "system", "Payment not completed in time"))
            p.final_status, p.payment_status, p.events = "CANCELLED", "FAILED", ev
            return
        if sc == "cust_cancel":
            t = p.paid_at + timedelta(minutes=rng.randint(2, 9))
            p.cancelled_at = t
            ev.append(("CANCELLED", t, None, "customer", "Cancelled by customer"))
            p.final_status, p.payment_status, p.events = "CANCELLED", "REFUNDED", ev
            p.refund, p.refund_amount, p.refund_at = "full", p.total, t + timedelta(minutes=rng.randint(2, 20))
            return
        t = placed + timedelta(minutes=rng.randint(1, 4 if p.requested_for else 5))
        if p.paid_at:
            t = max(t, p.paid_at + timedelta(seconds=15))
        ev.append(("CONFIRMED", t, staff, label, ""))
        p.confirmed_at = t
        if sc == "staff_cancel":
            t += timedelta(minutes=rng.randint(1, 3))
            ev.append(("PREPARING", t, staff, label, ""))
            t += timedelta(minutes=rng.randint(2, 6))
            reason = rng.choice(STAFF_CANCEL_REASONS)
            p.cancelled_at = t
            ev.append(("CANCELLED", t, staff, label, reason))
            p.final_status, p.payment_status, p.events = "CANCELLED", "REFUNDED", ev
            p.refund, p.refund_amount, p.refund_at = "full", p.total, t + timedelta(minutes=rng.randint(3, 30))
            p.notes = p.notes or ""
            return
        if p.requested_for:
            t = max(t + timedelta(minutes=1), p.requested_for - prep)
        else:
            t += timedelta(minutes=rng.randint(1, 3))
        ev.append(("PREPARING", t, staff, label, ""))
        t += prep
        ev.append(("OUT_FOR_DELIVERY" if delivery else "READY_FOR_PICKUP", t, staff, label, ""))
        p.ready_at = t
        t += eta if delivery else timedelta(minutes=rng.randint(2, 18))
        ev.append(("COMPLETED", t, staff, label, ""))
        p.completed_at = t
        p.final_status = "COMPLETED"
        p.payment_status = "PAID"
        if not online:
            p.paid_at = t
        p.events = ev
        p.failed_first = online and rng.random() < 0.06
        r = rng.random()
        if r < 0.045 and p.total > 4:
            p.refund = "partial"
            p.refund_amount = q(p.total * Decimal(rng.choice(["0.25", "0.30", "0.40", "0.50"])))
            p.refund_amount = max(min(p.refund_amount, p.total - Decimal("0.01")), Decimal("0.01"))
            p.payment_status = "PARTIALLY_REFUNDED"
            p.refund_at = min(t + timedelta(hours=rng.randint(1, 30)), self.now - timedelta(minutes=30))
        elif r < 0.055:
            p.refund, p.refund_amount, p.payment_status = "full", p.total, "REFUNDED"
            p.refund_at = min(t + timedelta(hours=rng.randint(2, 40)), self.now - timedelta(minutes=30))
        if p.refund_at and p.refund_at <= t:
            p.refund_at = t + timedelta(minutes=30)

    # --------------------------------------------------------------------------------------------------- build
    def build(self):
        from apps.accounts.models import StaffProfile  # noqa: F401  (ensures app loaded)

        self.load()
        self.seen_customers: set = set()
        self.bakery_used = 0
        raw = self.build_plans()
        plans = []
        for p in raw:
            ok = self.finish_plan(p)
            if not ok:
                continue
            self.timeline(p)
            plans.append(p)
        # numbers per (branch, local date)
        counter: Counter = Counter()
        for p in plans:
            key = (p.code, p.placed.astimezone(self.tz).date())
            counter[key] += 1
            p.number = f"{p.code}-{key[1]:%y%m%d}-D{counter[key]:03d}"
        with transaction.atomic():
            self.persist(plans)
        return plans

    # ------------------------------------------------------------------------------------------------- persist
    def persist(self, plans):
        from apps.catalog.models import Review
        from apps.inventory.models import InventoryMovement, StockItem
        from apps.notifications.models import Notification
        from apps.orders.models import Order, OrderItem, OrderItemOption, OrderNote, OrderStatusHistory
        from apps.payments.models import Payment, Refund
        from apps.promotions.models import Coupon, CouponRedemption

        s = self.s
        rng = self.rng
        orders = []
        for p in plans:
            addr = p.address
            snapshot = None
            if addr is not None:
                snapshot = {
                    "recipient_name": addr.recipient_name,
                    "phone": addr.phone,
                    "line1": addr.line1,
                    "line2": addr.line2,
                    "city": addr.city,
                    "postal_code": addr.postal_code,
                    "zone": addr.zone.name,
                    "zone_id": addr.zone_id,
                    "instructions": addr.instructions,
                }
            events_last = max([e[1] for e in p.events] + [p.refund_at or p.placed])
            o = Order(
                number=p.number,
                customer=p.customer,
                branch=p.branch,
                order_type=p.order_type,
                status=p.final_status,
                payment_status=p.payment_status,
                payment_method=p.method,
                currency="USD",
                subtotal=p.subtotal,
                discount_total=p.discount,
                delivery_fee=p.delivery_fee,
                tax_total=p.tax,
                tax_rate=Decimal("8.00"),
                prices_include_tax=False,
                total=p.total,
                refunded_total=p.refund_amount if p.refund else ZERO,
                coupon=p.coupon,
                coupon_code=p.coupon.code if p.coupon else "",
                customer_name=p.customer.full_name,
                customer_email=p.customer.email,
                customer_phone=p.customer.phone,
                delivery_address=snapshot,
                delivery_zone_name=addr.zone.name if addr else "",
                requested_for=p.requested_for,
                estimated_ready_at=p.requested_for
                or (
                    p.placed
                    + timedelta(
                        minutes=p.branch.prep_minutes
                        + max(ln_.product.prep_minutes for ln_ in p.lines)
                        + (p.terms[3] if p.terms else 0)
                    )
                ),
                customer_notes=rng.choice(NOTES) if rng.random() < 0.12 else "",
                terms_accepted_at=p.placed,
                idempotency_key=f"seed-{p.n}",
                is_demo=True,
                placed_at=p.placed,
                confirmed_at=p.confirmed_at,
                completed_at=p.completed_at,
                cancelled_at=p.cancelled_at,
                cancel_reason=next((e[4] for e in p.events if e[0] == "CANCELLED"), ""),
            )
            p.updated_at = events_last
            orders.append(o)
        Order.objects.bulk_create(orders)
        # bulk_create returns pks on PostgreSQL; fix updated_at (auto_now) afterwards
        for o, p in zip(orders, plans, strict=True):
            o.updated_at = p.updated_at
        Order.objects.bulk_update(orders, ["updated_at"])
        # items + options ------------------------------------------------------------------------------------
        items, item_plan = [], []
        for o, p in zip(orders, plans, strict=True):
            for ln in p.lines:
                items.append(
                    OrderItem(
                        order=o,
                        product=ln.product,
                        product_name=ln.product.name,
                        sku=ln.product.sku,
                        category_name=ln.product.category.name,
                        base_price=q(ln.product.base_price),
                        unit_price=ln.unit,
                        quantity=ln.qty,
                        line_total=ln.total,
                        discount_amount=ln.discount,
                        note=ln.note,
                    )
                )
                item_plan.append(ln)
        OrderItem.objects.bulk_create(items)
        opts = []
        for it, ln in zip(items, item_plan, strict=True):
            for opt in ln.options:
                opts.append(
                    OrderItemOption(
                        item=it,
                        option=opt,
                        group_name=opt.group.display_name,
                        option_name=opt.name,
                        price_delta=opt.price_delta,
                    )
                )
        OrderItemOption.objects.bulk_create(opts)
        # status history -------------------------------------------------------------------------------------
        hist = []
        for o, p in zip(orders, plans, strict=True):
            prev = ""
            for status, at, user, label, note in p.events:
                hist.append(
                    OrderStatusHistory(
                        order=o,
                        from_status=prev,
                        to_status=status,
                        actor=user,
                        actor_label=label,
                        note=note,
                        created_at=at,
                    )
                )
                prev = status
        OrderStatusHistory.objects.bulk_create(hist)
        OrderStatusHistory.objects.bulk_update(hist, ["created_at"])
        # payments / refunds ---------------------------------------------------------------------------------
        pays, refunds, pay_plan = [], [], []
        for o, p in zip(orders, plans, strict=True):
            sandbox = p.method in ("stripe", "demo")
            base = {"order": o, "provider": p.method, "amount": p.total, "currency": "USD", "is_sandbox": sandbox}
            if p.failed_first:
                pays.append(
                    Payment(
                        **base,
                        status="FAILED",
                        reference=f"demo_seed_{p.n}_f1",
                        idempotency_key=f"seed-pay-{p.n}-1",
                        failure_code="card_declined",
                        failure_message="Your card was declined (sandbox test card).",
                        created_at=p.placed + timedelta(seconds=10),
                    )
                )
                pay_plan.append((p, "failed"))
            status = {
                "PAID": "PAID",
                "PARTIALLY_REFUNDED": "PARTIALLY_REFUNDED",
                "REFUNDED": "REFUNDED",
                "FAILED": "FAILED",
                "REQUIRES_ACTION": "REQUIRES_ACTION",
                "PENDING": "PENDING",
            }[p.payment_status]
            if p.scenario == "abandoned":
                status = "FAILED"
            pay = Payment(
                **base,
                status=status,
                reference=f"demo_seed_{p.n}",
                idempotency_key=f"seed-pay-{p.n}-{2 if p.failed_first else 1}",
                provider_charge_id=f"ch_demo_seed_{p.n}" if (p.method == "stripe" and p.paid_at) else "",
                paid_at=p.paid_at if status in ("PAID", "PARTIALLY_REFUNDED", "REFUNDED") else None,
                refunded_total=p.refund_amount if p.refund else ZERO,
                created_at=p.placed + timedelta(seconds=(70 if p.failed_first else 2)),
                failure_code="expired" if p.scenario == "abandoned" else "",
                failure_message="Payment was not completed in time." if p.scenario == "abandoned" else "",
            )
            pays.append(pay)
            pay_plan.append((p, "main"))
        Payment.objects.bulk_create(pays)
        for pay, (p, kind) in zip(pays, pay_plan, strict=True):
            pay.created_at = p.placed + timedelta(seconds=(10 if kind == "failed" else (70 if p.failed_first else 2)))
            pay.updated_at = p.paid_at or p.refund_at or p.placed + timedelta(minutes=1)
        Payment.objects.bulk_update(pays, ["created_at", "updated_at"])
        main_pay = {p.n: pay for pay, (p, kind) in zip(pays, pay_plan, strict=True) if kind == "main"}
        for p in plans:
            if p.refund:
                pay = main_pay[p.n]
                reason = (
                    REFUND_REASONS[p.n % len(REFUND_REASONS)]
                    if p.scenario == "completed"
                    else (
                        "Order cancelled by customer" if p.scenario == "cust_cancel" else "Order cancelled by the café"
                    )
                )
                refunds.append(
                    Refund(
                        payment=pay,
                        amount=p.refund_amount,
                        reason=reason,
                        status="SUCCEEDED",
                        reference=f"demo_seed_refund_{p.n}",
                        idempotency_key=f"seed-refund-{p.n}",
                        initiated_by=self.staff_pick[p.code][0],
                        created_at=p.refund_at,
                        updated_at=p.refund_at,
                    )
                )
        Refund.objects.bulk_create(refunds)
        Refund.objects.bulk_update(refunds, ["created_at", "updated_at"])
        # coupon redemptions ---------------------------------------------------------------------------------
        reds = [
            CouponRedemption(
                coupon=o.coupon,
                user=o.customer,
                order=o,
                discount_amount=o.discount_total,
                is_voided=(o.status == "CANCELLED"),
            )
            for o in orders
            if o.coupon_id
        ]
        CouponRedemption.objects.bulk_create(reds)
        for r in reds:
            r.created_at = r.order.placed_at
        CouponRedemption.objects.bulk_update(reds, ["created_at"])
        counts = Counter(r.coupon_id for r in reds if not r.is_voided)
        for cp in self.coupons.values():
            Coupon.objects.filter(pk=cp.pk).update(times_redeemed=counts.get(cp.pk, 0))
            cp.times_redeemed = counts.get(cp.pk, 0)
        bakery = self.coupons["BAKERY3"]
        if (
            bakery.usage_limit is not None and bakery.times_redeemed < bakery.usage_limit
        ):  # keep the "exhausted" demo honest
            Coupon.objects.filter(pk=bakery.pk).update(usage_limit=max(bakery.times_redeemed, 1))
            s.warn(
                f"BAKERY3 only saw {bakery.times_redeemed} redemptions; its usage_limit was lowered to match so it still reads as exhausted"
            )
        # staff notes ----------------------------------------------------------------------------------------
        notes = []
        for o, p in zip(orders, plans, strict=True):
            if p.scenario == "completed" and rng.random() < 0.03:
                author = self.staff_pick[p.code][0]
                notes.append(
                    OrderNote(
                        order=o,
                        author=author,
                        body=rng.choice(
                            [
                                "Customer called to add oat milk.",
                                "Left at the front desk as requested.",
                                "Remade the drink — first one was too hot.",
                            ]
                        ),
                        created_at=p.placed + timedelta(minutes=8),
                    )
                )
        OrderNote.objects.bulk_create(notes)
        OrderNote.objects.bulk_update(notes, ["created_at"])
        # stock ledger ---------------------------------------------------------------------------------------
        self.rebuild_stock(plans, orders)
        # reviews --------------------------------------------------------------------------------------------
        self.make_reviews(plans, orders)
        # notifications for the demo customer ---------------------------------------------------------------
        self.make_notifications(plans, orders)
        s.stats["history: orders"] = len(orders)
        s.stats["history: order items"] = len(items)
        s.stats["history: payments"] = len(pays)
        s.stats["history: refunds"] = len(refunds)
        _ = (Review, InventoryMovement, StockItem, Notification)

    def rebuild_stock(self, plans, orders):
        from apps.inventory.models import InventoryMovement, StockItem

        s = self.s
        rng = random.Random(99)
        targets = s.STOCK_TARGETS
        sales = defaultdict(list)  # (branch_id, product_id) -> [(at, qty, ref, kind)]
        for p, o in zip(plans, orders, strict=True):
            for ln in p.lines:
                if ln.product.stock_mode != "STOCKED":
                    continue
                key = (p.branch.id, ln.product.id)
                sales[key].append((p.placed, -ln.qty, o.number, "SALE", "Sale"))
                if p.final_status == "CANCELLED":
                    sales[key].append(
                        (p.cancelled_at, ln.qty, o.number, "RETURN", "Returned to stock (order cancelled)")
                    )
        names = {p.id: n for n, p in self.products.items()}
        codes = {b.id: c for c, b in s.branches.items()}
        start = self.now - timedelta(days=91)
        movements, stock_updates = [], []
        for si in StockItem.objects.filter(product__is_demo=True).select_related("product", "branch"):
            key = (si.branch_id, si.product_id)
            evs = sorted(sales.get(key, []), key=lambda e: e[0])
            net_out = -sum(d for _, d, *_ in evs)
            target = targets.get((names[si.product_id], codes[si.branch_id]))
            if target is None:
                target = rng.randint(8, 55) if si.product.product_type != "GIFT" else rng.randint(3, 12)
                if codes[si.branch_id] == "AK":
                    target = rng.randint(5, 18)
            extra = []
            fixed = (names[si.product_id], codes[si.branch_id]) in targets
            if not fixed and net_out >= 6 and rng.random() < 0.7:
                recv = rng.randint(10, 30)
                extra.append(
                    (
                        self.now - timedelta(days=rng.randint(20, 60)),
                        recv,
                        f"PO-DEMO-{si.id:03d}",
                        "RECEIPT",
                        "Supplier delivery (demo)",
                    )
                )
            if not fixed and rng.random() < 0.25:
                extra.append(
                    (
                        self.now - timedelta(days=rng.randint(5, 40)),
                        -1,
                        "",
                        "WASTE" if si.product.product_type == "BEANS" else "ADJUSTMENT",
                        "Damaged packaging (demo)"
                        if si.product.product_type != "GIFT"
                        else "Stock count correction (demo)",
                    )
                )
            allev = sorted(evs + extra, key=lambda e: e[0])
            delta_total = sum(d for _, d, *_ in allev)
            initial = max(target - delta_total, 0)
            run, low = initial, initial
            for _, d, *_ in allev:
                run += d
                low = min(low, run)
            if low < 0:
                initial += -low
            qty = initial
            rows = []
            if initial:
                rows.append((start, initial, initial, "INITIAL", "Initial stock (demo seed)", "seed"))
            for at, d, ref, kind, reason in allev:
                qty += d
                rows.append((at, d, qty, kind, reason, ref))
            si.quantity = qty
            stock_updates.append(si)
            InventoryMovement.objects.filter(stock_item=si).delete()
            actor = s.users["inventorymanager"]
            for at, d, after, kind, reason, ref in rows:
                if d == 0:
                    continue
                movements.append(
                    InventoryMovement(
                        stock_item=si,
                        movement_type=kind,
                        quantity_delta=d,
                        quantity_after=after,
                        reference=ref,
                        reason=reason,
                        actor=actor if kind in ("RECEIPT", "ADJUSTMENT", "WASTE", "INITIAL") else None,
                        created_at=at,
                    )
                )
        InventoryMovement.objects.bulk_create(movements)
        InventoryMovement.objects.bulk_update(movements, ["created_at"])
        StockItem.objects.bulk_update(stock_updates, ["quantity"])
        s.stats["history: stock movements"] = len(movements)

    def make_reviews(self, plans, orders):
        from apps.catalog.models import Review

        s = self.s
        rng = random.Random(123)
        reviewer = s.users["productmanager"]
        taken = set()
        out = []
        for p, o in zip(plans, orders, strict=True):
            if p.final_status != "COMPLETED" or not p.completed_at or rng.random() > 0.2:
                continue
            ln = rng.choice(p.lines)
            key = (ln.product.id, p.customer.id)
            if key in taken or p.completed_at > self.now - timedelta(hours=3):
                continue
            taken.add(key)
            rating = rng.choices([5, 4, 3, 2, 1], [52, 30, 11, 5, 2])[0]
            pool = ppl.REVIEW_TEXTS[ln.product.product_type]
            if ln.product.product_type not in ("BEVERAGE", "FOOD"):
                rating = max(rating, 4)
            title, body = pool[rng.randrange(len(pool))] if rating >= 4 else pool[-1]
            created = min(p.completed_at + timedelta(hours=rng.randint(2, 72)), self.now - timedelta(hours=1))
            out.append(
                Review(
                    product=ln.product,
                    user=p.customer,
                    order=o,
                    rating=rating,
                    title=title,
                    body=body,
                    status="APPROVED",
                    is_demo=True,
                    moderated_by=reviewer,
                    moderated_at=created + timedelta(hours=rng.randint(1, 20)),
                    created_at=created,
                )
            )
        out.sort(key=lambda r: r.created_at)
        for r in out[-5:]:  # the freshest few wait in the moderation queue
            r.status, r.moderated_by, r.moderated_at = "PENDING", None, None
        if len(out) > 12:
            r = out[3]
            r.status, r.title, r.body, r.rating = (
                "REJECTED",
                "Not about this product",
                "Delivery took a while but the courier was friendly.",
                3,
            )
            r.moderated_at = r.created_at + timedelta(hours=5)
        Review.objects.bulk_create(out)
        s.stats["history: reviews"] = len(out)

    def make_notifications(self, plans, orders):
        from apps.notifications.models import Notification

        try:
            from apps.notifications.services import copy_for
        except Exception:  # noqa: BLE001
            copy_for = None
        demo = self.s.users["customer"]
        mine = [(p, o) for p, o in zip(plans, orders, strict=True) if p.customer.id == demo.id]
        mine = sorted(mine, key=lambda po: po[0].placed)[-6:]
        rows = []
        for p, o in mine:
            kinds = [("order_placed", p.placed)]
            if p.paid_at and p.method != "cash" and p.scenario != "abandoned":
                kinds.append(("payment_confirmed", p.paid_at))
            for status, at, *_ in p.events[1:]:
                kind = {
                    "CONFIRMED": "order_confirmed",
                    "PREPARING": "order_preparing",
                    "READY_FOR_PICKUP": "order_ready",
                    "OUT_FOR_DELIVERY": "order_out_for_delivery",
                    "COMPLETED": "order_completed",
                    "CANCELLED": "order_cancelled",
                }[status]
                kinds.append((kind, at))
            if p.refund:
                kinds.append(("refund_updated", p.refund_at))
            for kind, at in kinds:
                if copy_for:
                    try:
                        c = copy_for(o, kind)
                        title, body = c.title, c.body
                    except Exception:  # noqa: BLE001
                        title, body = kind.replace("_", " ").capitalize(), f"Order {o.number}"
                else:
                    title, body = kind.replace("_", " ").capitalize(), f"Order {o.number}"
                rows.append(
                    Notification(
                        user=demo,
                        order=o,
                        kind=kind,
                        title=title[:120],
                        body=body[:300],
                        is_read=at < self.now - timedelta(days=3),
                        email_status="skipped",
                        created_at=at,
                    )
                )
        Notification.objects.bulk_create(rows)
        Notification.objects.bulk_update(rows, ["created_at"])
        self.s.stats["history: notifications"] = len(rows)


def generate_history(seeder) -> None:
    from apps.orders.models import Order

    if Order.objects.filter(is_demo=True).exists():
        seeder.say("demo order history already present - skipping (use --reset-demo to rebuild with fresh dates)")
        seeder.stats["history: skipped (already present)"] += 1
        return
    HistoryBuilder(seeder).build()
