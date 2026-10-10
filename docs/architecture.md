# Architecture notes

See `implementation-plan.md` for the contract and `security.md` / `payments.md` / `operations.md` / `performance.md` for the deep dives.

## Runtime topology
```
Browser ─▶ nginx (prod) / Vite dev proxy ─┬─▶ static SPA (frontend/dist, hashed assets cached 1y)
                                           ├─▶ Django (gunicorn): /api/v1, /media (via shared volume in nginx), /django-admin,
                                           │      /sitemap.xml, /robots.txt, SEO shell for HTML navigations
                                           └─▶ PostgreSQL 16 (system of record)   Redis 7 (cache, throttles, Celery broker)
Celery worker + beat: transactional email, unpaid-order expiry, payment reconciliation, stale-cart cleanup
```
Redis is **not** a source of truth. `django-redis` runs with `IGNORE_EXCEPTIONS`, so a Redis outage turns cache reads into
misses and throttles into no-ops; orders, payments and stock continue to work from PostgreSQL. Celery enqueue failures are
swallowed by the notification service (the in-app notification row is committed with the business change; the email is the
only thing lost).

## Catalogue availability model
- `Product.stock_mode = PREPARED` (drinks, food made to order): no quantities. A product is purchasable when it is active, in an
  active category, not globally `is_sold_out`, and has no `BranchProduct(is_available=False)` row for the branch (absence = available).
  Staff "86" an item per branch from the inventory page.
- `Product.stock_mode = STOCKED` (beans, merchandise, gift sets): `StockItem.quantity` per branch (DB check ≥ 0).
  Deducted when the order is **placed** (row-locked, ordered by id to avoid deadlocks), restored exactly once on cancel/expiry.
  Every change writes an `InventoryMovement` (type, delta, quantity_after, reference, actor).
- Order lines snapshot product name, SKU, category, base price, option names/deltas and unit/line totals; later catalogue edits never
  change history (`OrderItem.product` is `SET_NULL`).

## Money, currency and tax
Decimal everywhere (2 dp, half-up), serialised as strings. Currency and tax come from `StoreSettings` (seeded from env defaults).
Tax is configurable: `tax_rate` %, `tax_label`, `prices_include_tax`. **The seeded 8 % is a demo placeholder; the owner must
confirm the legally required rate/inclusivity.** Delivery fees are not taxed by default. One implementation computes prices:
`apps/cart/pricing.py` (used by quote, cart preview and checkout; browser-supplied money fields are ignored).

## State machines
- Order: PENDING → CONFIRMED → PREPARING → READY_FOR_PICKUP | OUT_FOR_DELIVERY → COMPLETED, cancel from PENDING/CONFIRMED/PREPARING.
  Row-locked, history-recorded, idempotent (`apps/orders/state.py`, `services.py`).
- Payment attempt: PENDING → REQUIRES_ACTION → PAID | FAILED | CANCELLED → PARTIALLY_REFUNDED/REFUNDED. Monotonic; late failures after
  success are ignored and logged; DB constraint `one_settled_payment_per_order` prevents double settlement.

## Caching (all in Redis, versioned keys `lantern:v{n}:{namespace}:{hash}`)
| Namespace | What | TTL | Invalidation |
|---|---|---|---|
| `catalog` | categories, product list/detail (without branch availability), collections, tags, facets, suggest, delivery zones, sitemap | 60 s (sitemap 300 s) | `bump("catalog")` from model signals (immediate + on commit) |
| `settings` | store payload, content pages, blocks | 60 s | `bump("settings")` on admin writes |
| `reports` | dashboard payload | 60 s | TTL; key includes branch scope, filters and `customers.view` |
Never cached: carts, orders, favourites, notifications, branch availability overlay, anything user-specific.

## Background jobs
| Task | Trigger | Behaviour |
|---|---|---|
| `notifications.send_notification_email` | on commit after an order/payment/refund event | 3 retries, exponential backoff (BACKOFF_BASE × 2ⁿ), records `email_status` (`queued → sent|failed`; console/locmem backends record `console`, never `sent`) |
| `accounts.send_password_reset_email` | password reset request | autoretry on OSError, 3× backoff |
| `accounts.send_verification_email` | registration, email change, "resend" | branded link `{SITE_URL}/verify-email?token=…`; token minted in the task (never in the broker), bound to user id + current address, 3-day expiry; no-op for verified/inactive users; autoretry on OSError, 3× backoff |
| `orders.expire_unpaid_orders` | beat, every 5 min | cancels online-payment orders unpaid after `UNPAID_ORDER_EXPIRY_MINUTES`, restores stock, voids coupon; `skip_locked`, idempotent |
| `orders.expire_unconfirmed_cash_orders` | beat, every 5 min | cancels cash orders staff never confirmed (PENDING, cash not collected) as "Not confirmed by the branch in time", through the same system cancellation (stock restored, coupon voided, customer notified); `skip_locked`, idempotent. Deadline: ASAP orders `placed_at + CASH_ORDER_EXPIRY_MINUTES` (default 120); scheduled orders (`requested_for` set) the **later** of that and `requested_for − branch.prep_minutes`, so a booked slot is never cancelled before the branch had a chance to start it and booking a near slot cannot shorten the grace period |
| `payments.reconcile_open_payments` | beat, every 10 min | asks the provider about open hosted-checkout attempts (lost webhooks) through the same idempotent event pipeline |
| `cart.cleanup_stale_carts` | beat, every 6 h | deletes abandoned guest carts |
Workers are `acks_late` with `reject_on_worker_lost`; tasks are idempotent so redelivery is safe.

## Cash-order limits (finding S8)
A cash order moves no money but holds stock and coupon usage, so it is bounded twice: it expires if the branch never confirms
it (`expire_unconfirmed_cash_orders`), and a customer may hold at most `MAX_OPEN_CASH_ORDERS_PER_CUSTOMER` (3) PENDING cash orders.
The cap is enforced in `place_order` (including zero-total orders forced to cash) and when `orders/{n}/pay/` switches an
order to cash, answering 409 `too_many_open_cash_orders` (`limit` in the error body). Both paths take `lock_customer()`
(`FOR NO KEY UPDATE` on the user row, first in the lock order customer → cart → coupon → branch → stock) so concurrent
requests cannot all pass the count. Retrying payment on an order that is already cash is not a switch and is never refused.

## Email verification (finding S9)
`User.email_verified_at` is null until the owner proves the mailbox. Verification never blocks browsing, checkout or payment;
it gates **which addresses we mail**:
- Order, payment and refund email (and any marketing email, via `accounts.services.can_send_marketing_email`) is sent only to a
  verified, active user, at the user's *current* address (not the checkout snapshot). Otherwise the in-app `Notification` is still
  created and `email_status` is `skipped_unverified`; the check is repeated when the queued task runs.
- Password-reset email always goes to the address on file; completing a reset also verifies the address.
- Token: `django.core.signing.dumps({uid, email}, salt="accounts.verify-email")`, valid 3 days, void after an email change.
- Endpoints (see API contract in `security.md` S9): `POST auth/verify-email/`, `POST auth/resend-verification/`; `email_verified`
  is part of `auth/me`, login, register and `account/` payloads. Changing the email in `account/` PATCH clears the flag, mails the
  new address (throttled `email_change`, 5/hour) and voids older links.
- Verified from the start: seeded demo users, `createsuperuser`, staff created by an administrator, and (data migration)
  all existing staff. Existing customers are unverified after upgrading: they keep ordering but receive no order email until they
  confirm (they can use "resend" from the banner).

## Edge cases worth knowing
- Checkout replay with the same `Idempotency-Key` returns the original order (HTTP 200). If the first call crashed before the payment step, the
  customer retries via `orders/{n}/pay/`.
- A cancelled paid order is **not** refunded automatically; it surfaces under "needs refund" until staff run a verified refund.
- Zero-total orders skip the payment provider (forced to cash method).
- `Order.payment_status` has no CANCELLED value: cancelled unpaid cash orders show PENDING (status carries the cancellation).
- Guest cart cookie `lantern_cart` (HttpOnly) is merged on login/registration.
