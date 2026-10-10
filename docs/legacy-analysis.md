# Legacy audit — `adhamhe6/coffeeshop-website`

Audited at commit `5e45245` ("added README file"). The legacy repository is **reference material only**; it was
copied to a scratch directory for execution and was never modified.

**Legend** — ✅ *verified* = observed by running the legacy app (Django 4.2.30, Python 3.13, its own SQLite DB, Django test
client, probe scripts) · 📖 *inferred* = read from code only, not exercised.

## 1. What exists

A small server-rendered Django 4.2 monolith (~2.3k lines incl. templates) with four apps:

| App | Contents |
|---|---|
| `pages` | `home`, `about`, `coffee` template views. No models. |
| `products` | `Product` (name, desc, price `Decimal(6,2)`, image, `is_active`, `publish_date`, `flag` = Hot/Cold). List, hot/cold lists, detail, "advanced filter" (name/description/price range). |
| `accounts` | `UserProfile` (1-1 to `auth.User`: address, city, state, zip, M2M favorites). Sign-up, sign-in, sign-out, profile edit, favorite add, favorites list. |
| `orders` | `Order` (one open "cart" order per user, `is_finished`), `OrderDetails` (line, price copy, qty), `Payment` (address, phone, **card number / expiry / CVV**). Cart add/remove/+/-, "payment", order list. |

Stack: Django templates + Bootstrap 4 + jQuery slim, SQLite, `django-credit-cards`, Pillow. No `requirements.txt`, no
Docker, no CI, no env-based config, no tests (all `tests.py` files are the empty stubs). The README claims PostgreSQL;
the code uses SQLite. `db.sqlite3` (with 2 users, 6 products, 1 order) and `__pycache__` are committed.

Seed data present in the committed DB: Caffe Americano 10, cafe latte 20, Cappuccino 30, Espresso 35, Chocolate Coffee 40
(Hot), Iced Coffee 45 (Cold) — 6 products, 6 JPEGs in `media/products/images`.

## 2. Workflows — what actually works

✅ **Verified working** (HTTP 200/302 and expected DB effects):
- Every public page renders: `/`, `/products/`, `/products/hot/`, `/products/cold/`, `/products/<id>/`, `/products/s/?name=…`,
  `/products/search/`, `/about/`, `/coffee/`, sign-in and sign-up pages; unknown product → 404; profile redirects anonymous users to sign-in.
- Registration creates a `User` + `UserProfile`; sign-in creates a session.
- Add to cart creates/updates an open `Order` and an `OrderDetails` row; **the client-supplied `price` query param is ignored**
  and the DB product price is stored (a good property, accidental or not).
- "Payment" marks the order finished and stores a `Payment` row.

⚠️ **Verified broken or unsafe**
- `GET /orders/add_to_cart?product_id=1&qty=abc` → **HTTP 500** (`ValueError` from `int(qty)`). Negative/zero quantities are only rejected on one of two branches.
- `GET /orders/remove_from_cart/99999` → **HTTP 500** (`DoesNotExist`, unhandled).
- Sign-up accepted the password `"p"` — Django's `AUTH_PASSWORD_VALIDATORS` is configured but never invoked because the view calls `create_user` directly.
- ✅ **Card number and CVV are stored in plaintext**: after one "payment" the `orders_payment` table contained
  `('4111111111111111', '123')`. No payment gateway exists; "paying" is a form post that flips `is_finished`. This is a
  PCI-DSS violation and the core reason the commerce layer must be discarded, not ported.

📖 **Inferred from code, not exercised**
- Favorites: `product_favorite` does `Product.objects.get(pk=…)` unguarded (500 on bad id); duplicate favorite shows a success message.
- Profile edit: re-reads the stored password hash from a form field and only rehashes when it does not start with `pbkdf2_sha256$` (fragile; hashes leaked to the template as a hidden field's value).
- Order list computes totals in Python loops (N+1 queries).

## 3. Business rules worth preserving

1. One open cart per customer; quantity merges for the same product (→ re-implemented as cart lines keyed by product+options signature).
2. **Price is taken from the database, never from the request** (→ elevated to a hard server-authoritative pricing rule).
3. A customer can only mutate their own cart lines (ownership check in `add_qty`, `sub_qty`, `remove_from_cart`).
4. Quantity cannot go below 1 via "−" (→ becomes "remove").
5. Product visibility flag `is_active`; ordering newest first.
6. Favorites are a per-customer product set shown from the account menu.
7. Product search by name/description (case-insensitive default) and price range (→ replaced by full search + facets).
8. Order line price snapshot (`OrderDetails.price`) — the right idea, extended to name/options/tax.

## 4. Bugs and incomplete flows

- Unhandled exceptions on malformed input (above); no 404/500 pages.
- Price-range filter is silently ignored unless *both* bounds are provided.
- `Order.total`/`items_count` are class attributes patched onto instances in views; never persisted. Totals are recomputed from *current* line prices on every view, so they can drift from what was shown.
- No order status beyond `is_finished`; "order tracking" is a list of orders with a finished/open flag. No placed-at vs. cart distinction (the cart *is* the order).
- Sign-in with `rememberme` unchecked sets browser-session expiry (fine) but failures redirect with an error flash only; sign-in redirect always returns to sign-in (the `return reverse(...)` line is commented out).
- Cart is unavailable to guests: add-to-cart requires login and drops the item.
- `core/urls.py` serves static through `STATIC_ROOT` (unset) in DEBUG.
- Footer links (`Facebook`, `YouTube`, `Twitter`) are `href="#"`; phone numbers are fake.
- README install steps reference a non-existent `requirements.txt` and a different repo URL.

## 5. Authentication and authorization weaknesses

- State-changing **GET** endpoints (`add_to_cart`, `add_qty`, `sub_qty`, `remove_from_cart`, `product_favorite`, `logout`) → CSRF-able via image tags/links.
- Password validators bypassed on registration (verified); no password change or reset; no email verification; email uniqueness is case-sensitive.
- `request.user.is_authenticated and not request.user.is_anonymous` pattern everywhere instead of `login_required`; authorization lives in view bodies.
- No staff roles beyond Django's `is_staff`/`is_superuser`. The legacy admin customisation is cosmetic (`templates/admin/base_site.html`, `admin.css`); orders/payments are not even registered in `admin.py`.
- `SECRET_KEY` committed, `DEBUG = True`, `ALLOWED_HOSTS = []`.

## 6. Database design weaknesses

- Cart and order are the same row; no immutable order snapshot (product name/option/price/tax), no order number, no timestamps beyond `order_date`, no status history.
- `CASCADE` on `Order → User` and `OrderDetails → Product`: deleting a product deletes historical order lines.
- Money in `Decimal(6,2)` (fine for type, too small for totals); no check constraints (quantity can be ≤ 0 at DB level), no unique constraint on (order, product), no indexes beyond FKs.
- `UserProfile` address fields are all required, single address only, free-text; `zip_number` max length 5.
- Card data columns (see §2). No payment status, provider reference or refund concept.
- No categories, SKUs, slugs, modifiers/sizes, stock, branches, coupons, taxes, delivery.

## 7. UX / UI weaknesses

- Bootstrap 4 defaults with handwritten fonts from a remote Google Fonts `@import` (`Merienda`, `Gloria Hallelujah`); no brand system; navbar-heavy dropdown navigation; inconsistent spacing.
- No product customisation (size/milk/shot), so "coffee" is a single SKU with a flat price.
- Cart/checkout is a Bootstrap table + a raw card form; no price breakdown, fees, pickup/delivery choice, confirmation page or tracking.
- Server round-trips and full-page reloads for every action; flash messages only.
- Not demonstrably responsive beyond Bootstrap's grid; no accessibility work (📖 missing labels on icon links, colour-only states).

## 8. Security & performance issues

- Plaintext card data (critical). Plaintext secret key, debug on.
- CSRF via GET mutations; unhandled exceptions leak stack traces under DEBUG.
- N+1 queries in order list; unbounded list pages (no pagination).
- Remote font dependency in CSS.
- No rate limiting, no security headers config, no logging.

## 9. Valuable assets

- **Domain knowledge**: the coffee-shop customer journey, one-open-cart rule, hot/cold split (becomes the "Hot / Iced" modifier), favorites.
- **Product list** (6 drinks, prices 10–45) → inspiration for the new, much larger curated catalogue. The six JPEGs and brand `mycoffee.png` are **not** reused: provenance/licence is unknown and the new product ships its own generated brand assets (see `docs/brand.md`).
- Account profile fields (name, address) → seed for the `Address` model.

## 10. Preserve / redesign / replace / discard

| Area | Decision |
|---|---|
| Django as the backend framework | **Preserve** (Django 5.2 LTS + DRF) |
| One-cart-per-customer, merge same lines, ownership checks | **Preserve** (rules), **redesign** (guest carts, merge on login, option-aware lines) |
| DB-authoritative pricing | **Preserve and strengthen** (single pricing service, never trust client) |
| Favorites | **Redesign** (own table, unique constraint, API, guest merge) |
| Accounts / profile | **Replace** (custom email-based `User`, validators, password change/reset, multiple addresses) |
| Orders | **Replace** (separate Cart / Order / OrderItem snapshots, status machine, history, branch, order types) |
| Payments | **Discard and replace** (provider abstraction; Stripe + isolated sandbox adapter + cash; no raw card data ever stored) |
| Product model | **Redesign** (categories, SKUs, slugs, modifiers, stock modes, allergens, collections, reviews) |
| Templates / Bootstrap UI | **Discard** → React + TypeScript SPA with a purpose-built design system |
| Django admin customisation | **Discard** → custom role-based operations dashboard (Django admin stays as a secondary tool) |
| Committed `db.sqlite3`, `__pycache__`, `media/` | **Discard**; seed command generates repeatable data |
| SQLite | **Replace** with PostgreSQL |
