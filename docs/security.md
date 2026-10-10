# Security review and controls

Independent review of the backend (Django 5.2 + DRF) performed against a private local instance (own database, port 8006),
by reading the code and attacking the running server. Findings have regression tests in `backend/tests/security/`.

## Threat model

| Asset | Threats considered |
|---|---|
| Customer accounts and PII (email, phone, addresses, orders) | credential stuffing, enumeration, session theft/fixation, IDOR, CSRF |
| Money flow (prices, coupons, payments, refunds) | price/discount tampering, replayed or forged webhooks, double settlement/refund, race conditions, sandbox adapter in production |
| Staff operations (RBAC, branch scope, inventory, content) | privilege escalation, cross-branch access, mass assignment |
| Availability | unbounded writes by anonymous clients, hostile bodies, expensive queries |
| Content/SEO surface | stored XSS, JSON-LD/HTML injection, open redirects, malicious uploads |

Attackers modelled: anonymous internet user, authenticated customer (including one targeting another customer), staff user
with a lesser role or a single branch scope. Not modelled: compromised host/database, malicious super admin, supply-chain compromise.

## Controls (with references)

- **Session auth + CSRF on every unsafe endpoint**, including anonymous ones: `apps/core/authentication.py` (`EnforceCsrfMixin` on login/register), DRF `SessionAuthentication` elsewhere. Webhooks are CSRF-free by design and authenticated by signature only.
- **Cookies**: HttpOnly session and guest-cart cookies, SameSite=Lax, Secure in prod (`config/settings/base.py`, `prod.py`). Session key rotates on login/register (`django.contrib.auth.login`); logout flushes the server session; password change/reset invalidates other sessions; suspended or deactivated users lose access immediately.
- **Login hygiene**: generic error, dummy hash for unknown emails (`apps/accounts/services.py`), `login`/`register`/`password_reset`/`verify`/`resend_verification`/`email_change`/`coupon`/`checkout`/`review`/`newsletter` throttles, 128-char password cap, password validators (min 10).
- **RBAC**: single role to capability map in `apps/accounts/permissions.py`; `HasCapability` on every staff view; branch scope via `scope_queryset_by_branch` / `branch_scope`; out-of-scope ids answer 404 (orders, payments, stock, branches, reports, dashboard). Only a SUPER_ADMIN can manage staff or grant the role.
- **Ownership**: customer endpoints filter by `request.user` (404 for foreign ids).
- **Commerce integrity**: nothing price-like is read from requests (`apps/cart/pricing.py`); options validated against the product; quantity 1-50; totals recomputed in one transaction with row locks (cart, coupon, branch, stock); DB check constraints; idempotency unique per (customer, key).
- **Payments**: signature verified over the raw body with the 5-minute Stripe tolerance (`providers/stripe.py`); `PaymentEvent` unique `(provider,event_id)` for replay safety; amount/currency must match; late events never regress state; DB constraint against double settlement; refunds locked and capped; demo adapter and its endpoints do not exist when `PAYMENT_DEMO_ENABLED` is false and are forced off by `prod.py`.
- **Uploads**: Pillow decode, type allow-list, size and pixel caps, EXIF stripped, re-encoded to WebP with generated names (`apps/catalog/images.py`).
- **SEO shell**: every value HTML-escaped, JSON-LD made script-safe, origin from `SITE_URL` not the Host header (`apps/core/seo.py`).
- **CSV exports** neutralise formula injection (`apps/reports/csv_export.py`). Reports use the ORM only; the single inlined SQL fragment is whitelisted.
- **Audit log** with secret scrubbing (`apps/core/audit.py`). Error envelope hides internals (`apps/core/errors.py`).
- **Added by this review**: Django-admin login throttle, hostile-body handling, guest-cart creation throttle, `no-store` on signed-in API responses, stricter production settings (`apps/core/middleware.py`, `apps/core/parsers.py`).

## Findings

Severity is for a production deployment. "Fixed" items have a failing-then-passing test in `backend/tests/security/test_security_hardening.py`.

| ID | Sev | Finding | Status / test |
|---|---|---|---|
| S1 | Medium | `/django-admin/login/` had no rate limit (40 consecutive wrong passwords accepted), a password-guessing path to superuser accounts. DRF throttles do not cover Django admin views. | Fixed: `AdminLoginThrottleMiddleware` (10/min per client address and 20/hour per account name). `TestDjangoAdminLoginThrottle` |
| S2 | Low | Unauthenticated 500s: non-ASCII `X-Demo-Signature` (`hmac.compare_digest` TypeError); request body above `DATA_UPLOAD_MAX_MEMORY_SIZE` on any JSON endpoint incl. webhooks; deeply nested JSON (RecursionError). All logged at ERROR, which causes alert noise and hides real faults. | Fixed: bytes comparison; `RequestDataTooBig` returns 413 `payload_too_large`; `SafeJSONParser` returns 400. `TestHostileRequestsAreClientErrors` |
| S3 | Low | 500s on extreme customer input: `quantity=10**30` on add-to-cart (Decimal overflow) and `requested_for=0001-01-01` on preview/checkout (OverflowError). | Fixed in `cart/pricing.py` and `branches/services.py`. `TestExtremeInputs` |
| S4 | Medium | Production settings accepted the placeholder `DJANGO_SECRET_KEY` from `.env.example` (40+ chars, not caught by the old check). A copy-pasted deployment would sign sessions/reset tokens with a public key. Production also trusted `http://localhost:5173` for CORS-with-credentials and CSRF by default. | Fixed: placeholder/low-entropy keys refused, `.env.example` key left blank, CORS/CSRF origins default to empty in prod. `TestProductionSettings` |
| S5 | Low-Med | Each anonymous add-to-cart without a valid cookie inserts a Cart row kept 90 days; a bot discarding cookies can grow the table without bound. | Fixed: `GuestCartCreateThrottle` (60/hour per address). `TestGuestCartCreationThrottle` |
| S6 | Low | Signed-in API responses (orders with addresses, notifications, admin lists) carried no `Cache-Control`. | Fixed: `PrivateApiCacheMiddleware` sets `private, no-store` when a session cookie is present and the view set no policy. `TestPersonalResponsesAreNotCacheable` |
| S7 | Low | nginx `/media/` and `/assets/` locations replaced (not inherited) the server-level security headers, so no `nosniff`. | Fixed in `deploy/nginx.conf` (nosniff, restrictive CSP on `/media/`). Not unit-testable here; `nginx -t` was not available. |
| S8 | Medium (business) | Cash orders never expired (`expire_unpaid_orders` excludes `cash`), and a customer could switch an order to cash via `/orders/{n}/pay/`, holding STOCKED inventory and exhausting a coupon's `usage_limit` with unfulfilled cash orders. | **Fixed.** `orders.expire_unconfirmed_cash_orders` (beat, 5 min) cancels PENDING, uncollected cash orders after `CASH_ORDER_EXPIRY_MINUTES` (120; scheduled orders: later of that and slot start minus branch prep time) as "Not confirmed by the branch in time" - stock restored, coupon voided, customer notified. `MAX_OPEN_CASH_ORDERS_PER_CUSTOMER` (3) PENDING cash orders per customer, enforced in `place_order` and in the pay-switch under one per-customer row lock; 409 `too_many_open_cash_orders`. `apps/orders/tests/test_cash_orders.py` (incl. threaded cap test). |
| S9 | Medium | No email verification: anyone could register or change email to an address they do not own, sending order/notification email to a third party and setting marketing opt-in for them. | **Fixed (low friction).** `User.email_verified_at`; verification mail on registration and email change; `POST auth/verify-email/`, `POST auth/resend-verification/`; order/payment/refund (and marketing) email only to verified addresses, in-app notifications always (`email_status=skipped_unverified`); purchases are never blocked; password-reset confirmation also verifies. Details below. Tests: `apps/accounts/tests/test_email_verification.py`, `apps/notifications/tests/test_unverified_email.py`. |
| S10 | Low | Account enumeration: register and email-change answer "already exists"; `coupons/validate` distinguishes unknown vs known-but-ineligible codes. Login, password reset and newsletter are uniform. | Accepted (UX); mitigated by per-IP throttles. Proxy/WAF limits advised. |
| S11 | Low | Login throttling keys on client IP only. Behind a mis-set `NUM_PROXIES` (or with the backend directly reachable) a rotating `X-Forwarded-For` bypasses it (verified: 14 attempts, no 429). No per-account lockout. | Config risk, see checklist. Per-account lockout deliberately not added (lock-out DoS); add proxy rate limiting/CAPTCHA. |
| S12 | Info | ORDER_MANAGER and SUPPORT_AGENT see all customers' PII although orders are branch-scoped. Tests document this as intended (`test_order_manager_and_support_have_global_visibility`). INVENTORY_MANAGER/MARKETING_MANAGER hold `reports.view` (aggregate payments/customer reports, no PII). | Accepted, noted for owners. |
| S13 | Info | `/api/v1/schema/` and `/docs/` are public and list admin endpoints. | Accepted; restrict at the proxy if undesired. |
| S14 | Info | `/django-admin/` has only `Group` registered but is reachable and `is_staff=True` is set for every staff role. | Throttled (S1); restrict by IP at the proxy or remove from prod URLs. |

### S8 / S9 design notes and API contract

- **Cash-order expiry rule**: ASAP orders (`requested_for` null) expire at `placed_at + CASH_ORDER_EXPIRY_MINUTES`; scheduled orders at
  `max(placed_at + CASH_ORDER_EXPIRY_MINUTES, requested_for - branch.prep_minutes)`. Orders that are CONFIRMED or beyond, or whose cash was
  already collected, are never touched. The cap counts PENDING cash orders only (confirmed/cancelled/completed free the slot).
- **Verification token**: `signing.dumps({"uid", "email"}, salt="accounts.verify-email")`, `max_age` 3 days. Tampering, expiry, an inactive
  user or an address that changed since the mail was sent all answer the same `400 invalid_token`.
- `POST /api/v1/auth/verify-email/` `{token}` - no sign-in needed, idempotent, scope `verify` (20/hour per client). 200 `{detail, email_verified: true}`.
- `POST /api/v1/auth/resend-verification/` - signed in, scope `resend_verification` (5/hour per user). 202 `{detail, email_verified: false}`, or 200 `{email_verified: true}` with no email when already verified.
- `email_verified: bool` is on `user` in `auth/me`, `auth/login`, `auth/register` and `account/`; staff customer lists expose it too. `PATCH account/` with a new `email` returns `email_verified: false` and mails the new address (throttle `email_change`, 5/hour).
- Verification link: `{SITE_URL}/verify-email?token=...` (the SPA page posts the token to the endpoint).
- Residual: a registrant can still make us send *one* verification email to a third party per registration (bounded by the `register` throttle, 10/hour per client); the mail says to ignore it when unsolicited. Marketing consent is only honoured for verified addresses (`can_send_marketing_email`); no marketing sender exists yet, any new one must use it.
- Upgrade note: customers that registered before this change are unverified and stop receiving order email until they confirm.

## Verified safe (attacked live and/or by test)

- CSRF on anonymous login/register (403 without token); CORS preflight from a foreign origin gets no allow headers; Host header and `X-Forwarded-Host` spoofing rejected (`USE_X_FORWARDED_HOST=False`).
- Session fixation (pre-set cookie replaced at login), logout, password change/reset invalidating other sessions, reset-token reuse and suspended-user reset, suspended user mid-session.
- IDOR with another customer's order, address, notification, payment sync, demo payment, cancel/reorder/pay: all 404. Mass assignment on `/account/` (`is_staff`, `is_superuser`), addresses (`user`, `is_deleted`, `id`) ignored.
- Role by endpoint matrix for 39 staff endpoints x 10 identities matched the capability map; a DT branch manager got 404 for Riverside orders (read, transition, notes, cash, cancel), payments (read, refund), stock (read, patch, adjust, movements, availability), branch (read, patch, hours, staff), reports and dashboard; cannot create/delete branches or write delivery zones; CSV export requires `reports.export`.
- Commerce: foreign option ids, duplicate options, injected `price`/`unit_price` fields, archived products, negative/huge/boolean/float quantities, coupon whitespace/case/unicode variants. Concurrency: 6 customers racing for stock of 3 (one winner, stock 1), 6 racing for a coupon with `usage_limit=1` (one winner), 8 simultaneous checkouts with one Idempotency-Key (one order, 7 replays), same key from another user creates its own order.
- Stripe/demo webhooks: missing/garbage signature, GET, oversize body, existing suite covers tolerance, replay, mismatch, ordering, concurrency. Prod settings: demo provider and its endpoints 404, providers `['cash']`, HSTS and Secure cookies set.
- Uploads: SVG, appended PHP/script, `../` names, GIF, empty/truncated, 9000x9000 and 60000x60000 PNG; stored names are generated `.webp`.
- XSS/injection: product name/description containing `</script>` and `<img onerror>` are escaped in title, meta and JSON-LD of the SEO shell; CMS markdown renders through `react-markdown` with `skipHtml`; `cta_url`/`link_url` limited to `/path` or http(s); search input fuzzed (regex metacharacters, NUL, long strings) with no 500s; no raw SQL; no outbound fetches of user URLs (no SSRF surface).
- Dependencies: `pip-audit` on the 58 installed Python packages and `npm audit --omit=dev` found no known vulnerabilities (2026-10-10).

## Not tested

Real Stripe (no keys; only the signed-event code paths in unit tests), real SMTP/Celery under a broker, TLS and the nginx/Docker stack end to end (`nginx -t` unavailable), browser behaviour of the SPA (CSP, client-side routing), timing side channels, load/performance DoS, Redis-outage behaviour of throttles (fail open by design), the full Django-admin UI, backup/restore, and the frontend source beyond the markdown renderer and redirect helper.

## Residual risks and deployment checklist

1. **HTTPS everywhere.** Terminate TLS in front of nginx, send `X-Forwarded-Proto` from that terminator only (nginx passes the inbound value through, so it must never be internet-facing directly), keep `SECURE_SSL_REDIRECT`, Secure cookies and HSTS on.
2. **Secrets**: unique `DJANGO_SECRET_KEY` (prod refuses placeholders), strong Postgres/Redis passwords (Redis has none in `docker-compose.yml`; keep it off public networks), Stripe live keys and `STRIPE_WEBHOOK_SECRET` only in the environment, never `ALLOW_DEMO_PAYMENTS_IN_PRODUCTION`, set `CSRF_TRUSTED_ORIGINS`/`CORS_ALLOWED_ORIGINS` only if cross-origin is needed.
3. **Client IP trust**: set `NUM_PROXIES` to the exact number of proxies in front of Django (nginx alone = 1, CDN + nginx = 2) and never expose Django's port; otherwise throttles and audit IPs are spoofable.
4. **Rate limit at the proxy**: public catalogue/search/health endpoints and `/api/v1/auth/*` have no or per-IP-only limits; add `limit_req` (keyed on the real client IP), WAF/CAPTCHA for login and register, and an IP allow-list or removal of `/django-admin/`.
5. **Add a CSP** (start with `Content-Security-Policy-Report-Only`; the SPA is same-origin with self-hosted fonts) and `Permissions-Policy` on the SPA shell; none is sent today.
6. **Staff accounts**: no MFA or forced password change exists; use long unique passwords and consider MFA via the proxy or an IdP.
7. **Backups**: PostgreSQL PITR and tested restores; `media/` volume; Redis is cache/broker only.
8. **Dependency scanning in CI**: `pip-audit` and `npm audit` on every push; `requirements.txt` uses ranges, so add a lock file (`pip-compile --generate-hashes`) for reproducible builds.
9. **Operational**: alert on `payment event ... outcome=error`, `duplicate_charge` and `amount_mismatch`; review `flagged` payments daily; rotate the Stripe webhook secret when staff leave; set `USE_ARGON2` only after adding `argon2-cffi`.
10. S8 and S9 are fixed. Set `SITE_URL` to the public storefront origin (verification links are built from it) and a real `EMAIL_BACKEND`; confirm `CASH_ORDER_EXPIRY_MINUTES` / `MAX_OPEN_CASH_ORDERS_PER_CUSTOMER` suit the branches' opening hours.
