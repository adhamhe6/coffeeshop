# Demo seed data

> **DEVELOPMENT / DEMO ONLY.** Everything `seed_demo` creates is fictional. The accounts below share a published password,
> the tax rate, addresses, phone numbers, social links and legal pages are **placeholders**, and the order history is
> synthetic. Never run this against a real store (the command refuses to, see *Safety*).

## Running it

```bash
cd backend
python manage.py migrate
python manage.py seed_demo                 # catalogue, imagery, content, branches, people, ~240 demo orders
python manage.py seed_demo --no-history    # everything except orders / reviews / notifications
python manage.py seed_demo --reset-demo    # delete ONLY demo rows, then seed again (re-anchors order dates to "now")
python manage.py seed_demo --skip-images   # do not copy images into media storage
python manage.py seed_demo --password 'S0me-other-pass'   # default: $DEMO_PASSWORD, else the password below
python manage.py seed_demo --update-existing   # also refresh non-demo seed rows that already exist (pages, branches...)
```

At the end it prints a per-model row-count table and what changed in this run.

### Idempotency and safety rules

| Kind of row | Behaviour on re-run |
|---|---|
| Products (`is_demo=True`), demo users (`*@lantern.example`), demo orders / reviews | seed-owned: created, or refreshed to the seed definition |
| A product whose slug/SKU exists but is **not** `is_demo` | never touched (a warning is printed) |
| Categories, collections, modifier groups, branches, zones, coupons, pages, blocks, social links, announcement, store settings | **created when missing, otherwise left alone** (so admin edits survive). `--update-existing` refreshes them |
| Store settings | only fields still holding the model default are filled in |
| Order history | generated once; if demo orders already exist it is skipped. Use `--reset-demo` to rebuild with fresh dates |
| Images | copied via `ImageField.save` only when missing or when the SHA-256 differs (demo products always follow the asset; other rows only with `--update-existing`) |

`--reset-demo` deletes: demo orders (with payments/refunds/items/history/notifications/redemptions), `is_demo` reviews,
`is_demo` products (their image files, stock rows, collection items, favourites, cart lines), and users / newsletter
subscribers on the `lantern.example` domain. Nothing else. Coupon `times_redeemed` is recomputed afterwards.

**Production guard:** the command exits with an error when `DEBUG` is off and the settings module is not `*.test`
(for example `config.settings.prod`) unless `--allow-production` is passed. A loud banner is printed on every run.

## Demo accounts — DEVELOPMENT-ONLY credentials

Password for **all** demo accounts: `Lantern-demo-2026!` (or whatever you pass in `--password` / `DEMO_PASSWORD`).

| Email | Role | Branch scope | Typical use |
|---|---|---|---|
| `customer@lantern.example` | Customer | — | Main shopper: 2 saved addresses, favourites, recent orders + notifications |
| `priya.raman@`, `jordan.ellis@`, `mei.zhang@`, `sam.okafor@`, `lucia.fernandez@` `lantern.example` | Customers | — | Sample customers with addresses (zones set) and favourites |
| `superadmin@lantern.example` | `SUPER_ADMIN` (+ Django superuser) | all | Everything incl. staff management, `/django-admin` |
| `admin@lantern.example` | `ADMIN` | all | Everything except staff management |
| `branchmanager.downtown@lantern.example` | `BRANCH_MANAGER` | Downtown (DT) | Orders, stock, hours for one branch |
| `ordermanager@lantern.example` | `ORDER_MANAGER` | Downtown + Riverside | Order queue, notes, cash collection |
| `productmanager@lantern.example` | `PRODUCT_MANAGER` | all | Catalogue, modifiers, review moderation |
| `inventorymanager@lantern.example` | `INVENTORY_MANAGER` | all | Stock levels & movements |
| `marketing@lantern.example` | `MARKETING_MANAGER` | all | Coupons, content, social links, reviews |
| `support@lantern.example` | `SUPPORT_AGENT` | all | Read-only orders/customers, notes |

All demo accounts are created **email-verified** (`email_verified_at` set; re-seeding verifies any that lost it), so demo orders
produce order emails (console backend in development) without a verification step. Accounts you register yourself start
unverified: use the emailed link, or `resend-verification` from a signed-in session.

(`lantern.example` is a reserved example domain: nothing is ever delivered to these addresses.)

## What is placeholder / needs the owner

| Item | Seed value | Why it matters |
|---|---|---|
| **Tax** | 8.00 %, exclusive, label *"Sales tax (demo rate)"* | **Placeholder.** The owner must confirm the legally correct rate and whether prices include tax |
| Support email / phone | `hello@lantern.example`, `+1 555 010 0100` (555-01xx is fictional) | Replace |
| Business address, legal name | "100 Placeholder Avenue, Harbour City", "[Legal entity name — placeholder]" | Replace |
| Branch addresses | Placeholder addresses, `is_placeholder_address=True` | Admin flags them "replace before launch" |
| Social links | `https://social.example/lantern-<platform>`, `is_placeholder=True` | Deliberately not real sites |
| Legal pages | privacy, terms, refund policy are **templates** marked *"[Template — replace with legal text reviewed by counsel]"* | Not legal advice |
| Branch timezone | `America/New_York` for all three | Pick the real one |
| Opening hours, delivery fees/minimums/ETAs | Illustrative | Edit in the dashboard |
| Calories / caffeine values | Rough estimates | Replace with measured values |

Content avoids invented claims: no certifications, no fake testimonials, no loyalty points (the "regulars" block only
describes favourites, saved addresses, reorder and coupon codes, which exist).

## What gets created

* **Store**: settings (brand "Lantern Coffee Roasters", USD, allowed checkout methods `stripe`, `demo`, `cash`), 5 social profiles,
  6 content pages (`about`, `faq`, `privacy`, `terms`, `refund-policy`, `contact`), 6 content blocks
  (`home.hero`, `home.story`, `home.sourcing`, `home.craft`, `home.loyalty`, `home.newsletter`), 1 announcement (WELCOME10), 6 newsletter subscribers.
  All of it is database content, editable from the dashboard.
* **Branches** (timezone `America/New_York`, weekday vs weekend hours, placeholder addresses):
  Downtown Flagship `DT` (pickup + delivery), Riverside `RS` (pickup + delivery), Airport Kiosk `AK` (pickup only, shorter hours).
  One future closure (Thanksgiving Day, Downtown). Delivery zones Old Town, Midtown, Harbour Quarter, Riverside, University District
  linked to branches with different fee / minimum / free-over / ETA. A few PREPARED items are switched off at AK/RS (`BranchProduct`).
* **Catalogue**: 13 categories, **73 products** (71 active; 1 archived summer drink and 1 ended bean lot are inactive, and 1 active bean lot is flagged sold out),
  SKUs `LC-xxxx`, short + long descriptions, allergens, tags, flags (featured / bestseller / seasonal / new), prep minutes.
  Autumn seasonal drinks: Maple Cinnamon Latte, Pumpkin Brûlée Latte, Spiced Orange Mocha, Spiced Apple Cider.
  Stock mode: drinks/food `PREPARED`; beans, equipment, merch and gift sets `STOCKED`.
* **Modifiers**: Size (drinks / espresso), Temperature, Ice level, Milk (+0.60 oat/almond, +0.50 soy), Extra shot (multiple, max 3, +0.90),
  Syrup (multiple, max 2, +0.50), Sweetness, Toppings, Decaf swap, Bag size (250 g / 1 kg +48), Grind, Food extras. Espresso has fewer groups than a
  latte; beans have bag size + grind; gift sets and equipment have none.
* **Collections**: Bestsellers, New Arrivals, Seasonal Menu, Signature Drinks, For the Coffee Lover.
* **Stock**: a `StockItem` per STOCKED product per branch (AK carries a small range) with an `INITIAL` movement, plus receipts,
  sales and returns from the order history so quantities equal the movement ledger. Deliberately: Ethiopia Guji @DT is low (3), Hand Burr Grinder @RS is low (2),
  Kenya Nyeri @RS is out (0), Costa Rica Honey is out everywhere.
* **Promotions** (descriptions say DEMO): `WELCOME10` (10 %, first order, min $8), `AUTUMN15` (15 % off Seasonal, max $6 off),
  `BEANS5` ($5 off beans, ≥ $30 of beans), `SUMMER24` (expired), `BAKERY3` ($3 off pastries — usage limit reached),
  `HAPPYHOUR` (automatic 10 % off Iced & Blended; the promotion model has no time-of-day window so it applies whenever active).
  There is no free-delivery coupon type, so none is invented.
* **People**: see the account table. Customers have addresses whose zones are served by the branches, and 3–6 favourites each.

## Order history

~**240 orders** across the last 90 days, deterministic (`random.Random(42)`) and anchored on "now":

* Morning and lunch peaks, more volume on Fri/Sat/Sun, slight growth over the period; within branch opening hours (branch timezone).
* **Today's live queue**: 12 orders — 2 `PENDING`, 2 `CONFIRMED`, 3 `PREPARING`, 2 `READY_FOR_PICKUP`, 1 `OUT_FOR_DELIVERY`, 2 `COMPLETED`.
* Older orders cannot still be open, so the rest are final: ≈ 90 % `COMPLETED` (some with partial/full refunds), ≈ 5 % `CANCELLED`
  (customer-cancelled while pending, staff-cancelled, or an unpaid online order that expired). Cancelled orders void their coupon redemption and return stock.
* Payment methods `stripe` (sandbox), `demo` (sandbox) and `cash`; `Payment.is_sandbox=True` for stripe/demo; references `demo_seed_<n>`;
  ~6 % of online orders have an earlier `FAILED` attempt that later succeeded; at most one settled payment per order.
* Numbers `{BRANCH}-{YYMMDD}-D{nnn}` (e.g. `DT-261010-D007`), `idempotency_key = seed-<n>`, `is_demo=True`.
* Totals follow the plan §5 / `apps/cart/pricing.py` rules exactly: `unit = base + Σ option deltas`, `line = unit × qty`,
  one discount (typed coupon replaces automatic promotions; otherwise the best automatic one), `min_order_total` compared with the eligible subtotal,
  discount distributed over eligible lines by largest remainder, delivery fee from the zone (free over threshold), tax = 8 % × (subtotal − discount) (delivery untaxed),
  `total = subtotal − discount + delivery + tax`. The test suite re-checks every demo order against these identities.
* `OrderStatusHistory` rows with plausible timestamps, coupon redemptions, staff notes, SALE/RETURN stock movements for STOCKED lines.
* **Reviews**: ~45 short generic demo reviews (`is_demo=True`), mostly `APPROVED`, 5 `PENDING` (moderation queue), 1 `REJECTED`; each attached to a product the
  reviewer received in a completed demo order. The UI must label them as demo content.
* **Notifications** for `customer@lantern.example`'s six most recent orders (wording from `apps/notifications/services.copy_for`).

## Imagery

All images are generated — **no stock photos and none of the legacy repository's product photos**. Run

```bash
cd backend
python scripts/generate_assets.py                    # everything → apps/core/seed_assets/
python scripts/generate_assets.py --only products --slug latte
```

The renderer is `backend/scripts/lantern_art/` (Pillow only; no extra dependency — Pillow is already in `requirements.txt`).
Style: flat editorial illustration, layered shapes with in-shape gradients, soft contact shadows, paper grain, one camera angle,
the brand palette (espresso `#2B1D16`, cream `#F7F0E3`, parchment `#EFE4D0`, sage `#5E6E55`, copper `#B4602B`) plus per-product tints.
Output is WebP under `apps/core/seed_assets/{products,categories,collections,branches,content,brand}/` (102 files, ≈ 4 MB):

| Group | Files |
|---|---|
| `products/` | one **distinct** 1200×1200 image per product (73), named by slug |
| `categories/` | 13 × 1200×800 |
| `collections/` | 5 × 1600×700 banners |
| `branches/` | storefront, riverside terrace, airport kiosk (1400×900) |
| `content/` | `hero` (1920×1080), `story`, `sourcing`, `craft` (1400×1000) |
| `brand/` | `og-default` (1200×630 social card), `logo`, `logo-light` (wordmarks), `logo-mark` (transparent) |

Per-product art specs live next to the product data in `apps/core/seed/catalog_data.py`; add a product there, re-run the generator, re-seed.
Generation is deterministic (per-image seeds from the slug). Bag labels and signs use the Caladea (serif) and Inter (sans) system fonts; if missing, Liberation/DejaVu are used
and only the lettering changes. Text drawn into images ("LANTERN" wordmark, origin names) is part of the demo brand.

## Tests

`backend/apps/core/tests/test_seed.py` runs the command twice on the test database and asserts: identical row counts (no duplicates), ≥ 55 products each with an existing,
unique image file, every demo order satisfying the money/status/payment/stock/coupon invariants, today's queue not empty, and that `--reset-demo` leaves a manually
created non-demo product (and a clashing non-demo slug) untouched. It also covers the production guard.

```bash
cd backend && DATABASE_URL=postgres://coffee:coffee@127.0.0.1:5432/coffee_seed pytest apps/core/tests/test_seed.py
```
