# Implementation plan — Lantern Coffee Roasters platform

Brand (editable demo identity): **Lantern Coffee Roasters** — warm, confident, editorial. Details in `docs/brand.md`.
Everything below is the contract between the people/agents building the pieces. `/api/v1/schema/` (drf-spectacular) is the
final source of truth for payload shapes; this document fixes *names, ownership, rules*.

## 1. Architecture

```
 Browser ── React SPA (Vite build, TanStack Query, RHF+Zod, Tailwind) ──┐
   storefront  /…            admin dashboard  /admin/…                  │  same origin
                                                                        ▼
                    nginx (prod) / Vite proxy (dev):  /api, /media, /django-admin, sitemap.xml, robots.txt, SEO shell → Django
                                                                        │
              Django 5.2 LTS + DRF  (session auth + CSRF, services layer, state machines)
                    │                     │                      │
              PostgreSQL 16 (truth)   Redis (cache, throttles, Celery broker)      Celery worker + beat
                                                                  (emails, expiry of unpaid orders, cleanup, CSV exports)
              Payment providers: stripe (official SDK, hosted Checkout, signed webhooks) · demo (sandbox simulator) · cash
```

Decisions & justifications
- **One Django backend** (legacy was Django; keeps domain knowledge, ORM, migrations, admin as secondary tool). No FastAPI.
- **Session auth + CSRF, same-site** via a reverse proxy: no tokens in browser storage; logout flushes the server session.
- **One React SPA** with a lazily-loaded `/admin` area sharing design tokens and API client. Two apps would duplicate the design system.
- **Service layer** (`services.py` per app) holds business rules; views only parse/serialize. Money is `Decimal` (2dp, half-up) end to end and serialized as strings.
- **SEO shell**: Django serves the built `index.html` for public routes with per-page `<title>`, description, canonical, Open Graph and JSON-LD injected from DB data (crawlers/social cards without a Node SSR service); the SPA also updates head tags client-side.
- **Stripe hosted Checkout** (redirect) rather than card fields: no card data touches our servers (SAQ-A); webhooks are the source of truth.
- **Checkout requires an account** (guests can browse, build a cart, and are prompted to sign in/register inline at checkout; cart merges on auth).

## 2. Repository layout

```
backend/   config/(settings/{base,dev,test,prod}, urls, api_urls, celery)  apps/{core,accounts,catalog,branches,inventory,promotions,cart,orders,payments,notifications,reports}  tests/  templates/
frontend/  src/{app,lib/api,design,features/{storefront,account,cart,checkout,orders,admin/*}}  e2e/
deploy/    nginx.conf, docker entrypoints
docs/      legacy-analysis.md implementation-plan.md brand.md architecture.md security.md payments.md operations.md
```
Each app: `models.py, services.py (business rules), selectors.py (read queries, optional), serializers.py, views.py, urls.py (storefront), admin_views.py + admin_urls.py (staff API), tasks.py, tests/`.
`config/api_urls.py` includes every app's `urls` and `admin_urls` (prewired; fill your own files only).

## 3. Cross-cutting rules (all code must follow)

1. **Errors**: raise `apps.core.errors.DomainError(message, code=…, status_code=…, fields=…)` for expected rule failures; envelope is `{"error": {"code","message","fields?","request_id"}}`. Unauthenticated → 401, forbidden → 403, validation → 400, state conflict → 409.
2. **Money**: `apps.core.money.q()`; never float. Currency comes from `StoreSettings.currency`.
3. **Transactions & locks**: any multi-row business operation is `transaction.atomic()` with `select_for_update()` on the rows whose invariants matter (stock rows, coupon row, order row on transitions, payment row on events).
4. **Auth**: staff endpoints use `apps.accounts.permissions.HasCapability.require("…")` and filter by `branch_scope`. Customer endpoints filter by `request.user` — a foreign id returns **404**, not 403.
5. **Audit**: call `apps.core.audit.audit(...)` for: price changes, product/category/modifier changes, stock adjustments, order status changes by staff, coupon CRUD, refunds, role/permission changes, branch/settings changes, customer suspension, content changes. Never put secrets/PII beyond ids/emails in `changes`.
6. **Caching**: public catalog reads use `apps.core.cache.cached("catalog", …)`; every catalog/branch/settings write calls `bump("catalog")`. Never cache user-specific responses. Redis outage must not 500 (configured `IGNORE_EXCEPTIONS`).
7. **Throttling**: `throttle_scope` on login, register, password reset, coupon validate, checkout, review, newsletter (rates in settings).
8. **Pagination**: `{count,next,previous,results}`; filters via query params; `ordering` param on lists.
9. **Images**: validate type (JPEG/PNG/WebP), size ≤ `MAX_IMAGE_UPLOAD_BYTES`, decode with Pillow to verify, reject others with a clear 400.
10. **Logging**: `logging.getLogger(__name__)`; log order creation, transitions, payment events, refunds, auth failures, permission denials. Never log passwords, tokens, card data, webhook secrets.
11. **Tests**: pytest, real PostgreSQL. Name DBs per agent via `DATABASE_URL` to avoid collisions. Test authorization (positive + negative) for every staff endpoint family.

12. **Image URLs in API payloads are root-relative** (`/media/products/x.webp`, `null` when none) so they work behind any proxy/CDN host.
13. **API payloads expose `is_demo`** wherever seeded demonstration content (reviews, orders) can appear; the UI labels it.

## 4. Capabilities and roles

Defined in `apps/accounts/permissions.py` (single source). `GET /auth/me/` returns `staff.capabilities` and `staff.branch_ids` (`null` = all). The SPA hides navigation by capability; the backend enforces regardless.

## 5. Domain rules

### Catalogue & modifiers
- Size/milk/shot/syrup/temperature are `ModifierGroup`s attached per product. Base price = smallest/default size; options add `price_delta`.
- Cart/quote/checkout validate: all required groups satisfied, `min_select ≤ n ≤ max_select`, options belong to the product's active groups, options active & available, quantity 1–50, product active & not sold out & category active.
- `Product.stock_mode`: `PREPARED` (drinks/food made to order → availability toggle per branch via `BranchProduct`, absence = available) vs `STOCKED` (beans, merch → `StockItem.quantity` per branch). Documented in `docs/architecture.md`.

### Pricing (single implementation: `apps/cart/pricing.py`)
`unit = base_price + Σ option.price_delta` → `line = unit × qty` → `subtotal = Σ line` → coupon/automatic discount (eligible lines only, capped at eligible amount, never > subtotal, `max_discount` respected) → delivery fee (zone, free-over rule; 0 for pickup) → tax = `tax_rate`% of (subtotal − discount) (+ delivery fee is **not** taxed by default) unless `prices_include_tax` (then tax is extracted, total unchanged) → `total = subtotal − discount + delivery_fee + tax(if exclusive)`. Rounding half-up per component. Returns an immutable breakdown + `issues[]` (price changed since added, unavailable, below minimum, coupon invalid…). **Nothing price-like is ever read from a request body.**

### Order status machine (`apps/orders/state.py`)
```
PICKUP:    PENDING → CONFIRMED → PREPARING → READY_FOR_PICKUP → COMPLETED
DELIVERY:  PENDING → CONFIRMED → PREPARING → OUT_FOR_DELIVERY → COMPLETED
CANCEL:    PENDING|CONFIRMED|PREPARING → CANCELLED        (terminal: COMPLETED, CANCELLED)
```
- Online-payment orders cannot move to CONFIRMED until `payment_status ∈ {AUTHORIZED, PAID}`; cash orders may be confirmed immediately (collected at handover; `payments.collect` marks PAID).
- `StoreSettings.auto_confirm_paid_orders` lets the payment-success handler confirm automatically.
- Customers may cancel only while `PENDING`. Cancelling restores stock, voids the coupon redemption, and **does not** imply a refund — a refund is a separate, verified provider operation (`cancel` accepts `refund=true` to attempt one and reports the actual outcome).
- Every transition: row-locked, validated, writes `OrderStatusHistory` (actor, from, to), sets timestamps, triggers `notify_order_event`, and is idempotent for repeated identical requests (a repeat of an already-applied transition returns the current order with 200; an invalid one returns 409 `invalid_transition`).

### Payment status
`Order.payment_status` mirrors the latest meaningful `Payment`. Payment states: PENDING → REQUIRES_ACTION → (AUTHORIZED|PAID|FAILED|CANCELLED) → PARTIALLY_REFUNDED/REFUNDED. DB unique constraint `one_settled_payment_per_order` prevents double settlement. Provider events are recorded in `PaymentEvent` with unique `(provider,event_id)`; replays are no-ops; out-of-order events never regress state (e.g. a late `failed` after `paid` is ignored and logged). `PAID`/`FAILED` transitions happen **only** from a verified provider event or a provider API retrieval — never from a browser redirect.
Refunds: `Refund` rows created PENDING, executed via provider with idempotency key, flip to SUCCEEDED/FAILED; payment/order refunded totals updated in the same transaction; amount ≤ paid − already refunded.

### Inventory
Stock deducted (SALE movement, row-locked) when an order is **placed** for STOCKED lines; restored (RETURN) on cancel/expiry/failed-payment-expiry exactly once. Insufficient stock → 409 `out_of_stock` listing items. Quantities can never go negative (DB check).
Unpaid online orders expire after `UNPAID_ORDER_EXPIRY_MINUTES` (Celery beat) → CANCELLED, stock restored, coupon voided.

### Delivery & pickup
Pickup: branch `pickup_enabled`, open at requested time (or now), ASAP = now + prep. Delivery: branch `delivery_enabled`, address must have a `zone` served by the branch (`BranchDeliveryZone` active), subtotal ≥ zone minimum, fee from zone (free over threshold). `requested_for` must lie in an opening window of the branch (15-minute slots, ≥ prep time ahead, ≤ 7 days). Branches paused (`accepting_orders=false`), closures, global `ordering_enabled=false` all reject checkout with specific error codes.

### Checkout idempotency
`POST /checkout/` requires `Idempotency-Key` (UUID). Unique `(customer, idempotency_key)`; a replay returns the original order/payment result (HTTP 200) instead of creating another. Cart is cleared in the same transaction that creates the order. If client sends `expected_total` and the recomputed total differs → 409 `price_changed` with the fresh breakdown.

### Notifications
`notify_order_event(order, kind)` creates an in-app `Notification` (committed with the business change) and enqueues an email task via `transaction.on_commit`. Email failures retry (3×, exponential) and never affect order/payment state; `email_status` records queued/sent/failed. Dev backend = console (documented as *not* real delivery).

### Reports (definitions are exposed at `/admin/reports/definitions/` and shown in the UI)
- **Gross sales** = Σ item line totals of orders not CANCELLED with payment_status ∈ {PAID, PARTIALLY_REFUNDED, REFUNDED} **or** payment_method=cash & status=COMPLETED.
- **Discounts**, **delivery fees**, **tax**, **refunds** shown separately; **Net sales** = gross − discounts − refunds (excl. tax & delivery); **Revenue (collected)** = total − refunded for counted orders.
- Orders counts by status use `placed_at` in the branch timezone; everything computed in SQL aggregates.

## 6. API map (`/api/v1`)

| Owner | Endpoints |
|---|---|
| **A** accounts/core | `auth/{csrf,register,login,logout,me,password-reset,password-reset/confirm}/` · `account/` (GET/PATCH) · `account/password/` · `addresses/` (+`{id}/set-default/`) · `notifications/` (+`{id}/read/`, `read-all/`) · `store/` (public settings, social, announcement, checkout methods) · `content/pages/{slug}/` · `content/blocks/` · `newsletter/subscribe/` · `health/{live,ready}/` · root `/healthz` · **admin**: `admin/customers/` (+`{id}/`, suspend/restore) · `admin/staff/` · `admin/settings/` · `admin/social/` · `admin/pages/` · `admin/blocks/` · `admin/announcements/` · `admin/newsletter/` · `admin/audit-logs/` · SEO: `/sitemap.xml`, `/robots.txt`, SEO shell views |
| **B** catalog/branches/inventory | `categories/` · `products/` (filters: `q,category,collection,tag,type,featured,bestseller,seasonal,new,min_price,max_price,branch,ordering`) · `products/{slug}/` · `products/suggest/` · `collections/` (+`{slug}/`) · `products/{slug}/reviews/` (GET/POST) · `favorites/` (+`ids/`, `{product_id}/` DELETE, `merge/`) · `branches/` (+`{slug}/`, `{slug}/slots/`) · `delivery-zones/` · **admin**: `admin/products/` (+image upload, archive, quick toggles, modifier assignment) · `admin/categories/` (+reorder) · `admin/modifier-groups/` (+nested options) · `admin/collections/` · `admin/tags/` · `admin/reviews/` (+approve/reject) · `admin/branches/` (+hours, closures, zone links, staff) · `admin/delivery-zones/` · `admin/inventory/{stock,movements,adjust,availability,summary}/` |
| **C1** cart/promotions/orders | `products/{slug}/quote/` · `cart/` (GET, DELETE) · `cart/items/` (+`{id}/` PATCH/DELETE) · `cart/preview/` · `coupons/validate/` · `checkout/` · `orders/` (+`{number}/`, `cancel/`, `reorder/`, `pay/`) · **admin**: `admin/coupons/` |
| **C2** payments/notifications/admin-orders | `payments/methods/` · `payments/webhooks/{stripe,demo}/` · `payments/demo/{reference}/` (+`complete/`) · `orders/{number}/payment/sync/` · **admin**: `admin/orders/` (+`{number}/`, `transition/`, `cancel/`, `notes/`, `collect-cash/`, `queue/`) · `admin/payments/` (+`{id}/`, `{id}/refund/`) |
| **C3** reports | `admin/dashboard/` · `admin/reports/{definitions,sales,orders-by-status,products,categories,branches,promotions,payments,refunds,inventory,customers}/` (+`?format=csv`) |

Shared service signatures (so owners can work in parallel):
```python
# apps/branches/services.py (B)
def assert_branch_accepts(branch, order_type, requested_for=None) -> None            # raises DomainError(code=branch_closed|ordering_paused|pickup_unavailable|delivery_unavailable|slot_invalid)
def delivery_terms(branch, zone, subtotal) -> DeliveryTerms(fee, min_order_total, eta_minutes)  # raises DomainError(code=zone_not_served|below_delivery_minimum)
def available_slots(branch, order_type, day) -> list[datetime]
# apps/inventory/services.py (B)
class StockShortage(DomainError)               # code="out_of_stock", extra={"items":[…]}
def availability(product, branch, quantity=1) -> tuple[bool, str | None]  # reason code: inactive|sold_out|branch_unavailable|out_of_stock
def deduct_stock_for_order(order) -> None      # STOCKED lines only; select_for_update; raises StockShortage
def restore_stock_for_order(order, *, reason) -> None   # idempotent
def adjust_stock(branch, product, *, delta=None, set_to=None, movement_type, reason, actor, reference="") -> StockItem
# apps/orders/state.py + services.py (C1)
def allowed_transitions(order) -> list[str]
def transition_order(order_id, to_status, *, actor, note="", system=False) -> Order
def cancel_order(order_id, *, actor, reason, by_customer=False) -> Order
def place_order(user, *, payload, idempotency_key) -> PlacedOrder(order, created: bool)
# apps/payments/services.py (C2)
def start_payment(order, provider_key, *, return_url, cancel_url) -> PaymentStart(payment, action)   # action: {"type":"redirect","url":…} | {"type":"none"}
def handle_provider_event(provider_key, event) -> PaymentEvent        # idempotent
def refund_payment(payment, amount, reason, actor) -> Refund
def mark_cash_collected(order, actor) -> Payment
# apps/cart/services.py (C1)
def merge_guest_cart(request, user) -> None     # reads cookie `lantern_cart`; called by A's login/register views
# apps/payments/registry.py (C2)
def enabled_provider_keys() -> list[str]; def get_provider(key) -> PaymentProvider
def describe_payment(order) -> dict              # {status, provider, is_sandbox, action|None, failure_message|None} for order payloads
# apps/notifications/services.py (C2)
def notify_order_event(order, kind) -> None     # kinds: order_placed|payment_confirmed|payment_failed|order_confirmed|order_preparing|order_ready|order_out_for_delivery|order_completed|order_cancelled|refund_updated
```

## 7. Frontend structure

`frontend/src/`: `app/` (router, providers, layouts), `lib/api/` (typed client from OpenAPI via `openapi-typescript`, fetch wrapper with CSRF + 401 handling), `design/` (tokens, primitives: Button, Input, Select, Dialog, Sheet, Tabs, Badge, Toast, Skeleton, EmptyState, DataTable, Money, Rating, StatusBadge…), `features/{storefront,catalog,cart,checkout,account,orders,admin/…}`, `hooks/`. Server state = TanStack Query; forms = React Hook Form + Zod; UI state = local/URL. Tests: Vitest + Testing Library (+ MSW), Playwright E2E.

Storefront routes: `/` · `/menu` · `/menu/:category` · `/p/:slug` · `/search` · `/favorites` · `/cart` · `/checkout` · `/pay/demo/:reference` (sandbox) · `/orders/:number/confirmation` · `/orders/:number` (tracking) · `/account` (profile) · `/account/addresses` · `/account/orders` · `/login` · `/register` · `/forgot-password` · `/reset-password` · `/locations` · `/about` · `/contact` · `/faq` · `/privacy` · `/terms` · `/refund-policy` · `*` 404.
Admin routes (`/admin/*`, capability-gated): overview · orders (queue, detail) · products (list, editor) · categories · options · collections · inventory · branches · customers · coupons · reviews · payments · staff · reports · content (pages/blocks/announcements) · social · settings · audit-log.

## 8. Visual design system (see `docs/brand.md`)

Espresso `#2B1D16` / Cream `#F7F0E3` / Parchment `#EFE4D0` / Sage `#5E6E55` / Copper accent `#B4602B` / Ink `#1B1410`. Serif display (Fraunces), sans UI (Inter Variable) — self-hosted via `@fontsource`. Square-ish 6–10px radii, hairline borders, flat surfaces, generous whitespace, editorial asymmetry on landing page; compact, dense, neutral admin theme with copper as the only accent. Reduced-motion respected. Status never conveyed by colour alone (icon + label).

## 9. Delivery phases

1. Foundation (done in this commit): audit, schema+migrations on PostgreSQL, settings, capability model, audit/cache/error helpers.
2. Parallel backend build (A, B, C1, C2, C3) + seed/imagery + frontend foundation.
3. Frontend storefront + admin pages against the real API.
4. Integration, hardening (security review, query review with EXPLAIN, failure scenarios), E2E (Playwright), visual QA, CI, Docker, README.
5. Final review & honest report.

## 10. Acceptance criteria (abridged — full gate in the final report)
Migrations apply to empty PostgreSQL; `seed_demo` idempotent; storefront purchase flow (browse → customise → cart → register → checkout pickup → sandbox pay → confirmation → visible in account) passes in a browser; admin processes that order through every status and the customer sees each; product CRUD reflected in storefront; failed payment → retry succeeds exactly once; duplicate webhooks/checkouts create no duplicates; role boundary tests pass; reports reconcile with SQL totals; CI workflow defined and locally verified command-by-command.
