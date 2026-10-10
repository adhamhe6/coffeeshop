# Payments

## Providers (`apps/payments/providers/`)
| Key | What it is | Money moves? | Where used |
|---|---|---|---|
| `stripe` | Official `stripe` SDK, **hosted Checkout Session** (redirect), signed webhooks, API retrieval for return-page sync and reconciliation, API refunds | Yes with live keys; test-mode with `sk_test_…` | Enabled only when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set and `stripe` is listed in `PAYMENT_PROVIDERS_ENABLED` |
| `demo` | **Sandbox simulator.** Redirects to the in-app page `/pay/demo/<reference>`; the buttons (success / decline / cancel) post an HMAC-signed event that goes through the *same* verify → idempotent-apply pipeline as real webhooks | **Never** | Disabled automatically by `config.settings.prod` unless `ALLOW_DEMO_PAYMENTS_IN_PRODUCTION=true` *and* a unique `PAYMENT_DEMO_WEBHOOK_SECRET` is set. Every payment it creates has `is_sandbox=true` and the UI labels it. |
| `cash` | Pay at pickup/delivery; payment stays PENDING until staff mark it collected | n/a | Always available |

No card number, CVV or card credential ever touches our servers or database (hosted Checkout). The legacy app stored them in plaintext.

## Lifecycle
1. `POST /checkout/` creates the order (server-priced) → `start_payment` creates a `Payment` attempt (idempotency key `pay-<order>-<n>`), amount = `order.total` computed server-side.
2. Customer is redirected to the provider. **A redirect is never proof of payment.**
3. Provider webhook (or `orders/{n}/payment/sync/` which *retrieves* the session from the provider, or the periodic reconcile task) is normalised to a `ProviderEvent` and applied by `handle_provider_event`:
   `PaymentEvent(provider, event_id)` unique → replays are no-ops; Payment and Order rows are locked in a fixed order; amount/currency must equal the payment's or the event is recorded as `error` and the payment is flagged (never marked paid); late `failed` after `paid` is `out_of_order` and ignored.
4. On `PAID`: order.payment_status=PAID, optional auto-confirm (`StoreSettings.auto_confirm_paid_orders`), notification. On `FAILED`: customer can retry (`orders/{n}/pay/`) – a fresh attempt, order stays PENDING until expiry.
5. Unpaid online orders are cancelled by the expiry task after `UNPAID_ORDER_EXPIRY_MINUTES`; cash orders the branch never confirms after `CASH_ORDER_EXPIRY_MINUTES` (see `architecture.md`), and switching an order to cash counts against `MAX_OPEN_CASH_ORDERS_PER_CUSTOMER`.

## Refunds
Staff with `payments.refund` (SUPER_ADMIN/ADMIN) call `admin/payments/{id}/refund/`. A `Refund` row is created PENDING with a stable idempotency key, the provider is called **outside** the DB lock, then the row becomes SUCCEEDED/FAILED and payment/order refunded totals update atomically. Over-refunds are rejected under row locks. Cancelling an order never changes payment state by itself; "cancel with refund" reports the real provider outcome. Cash "refunds" are recorded manual hand-backs, not provider operations.

## Activating Stripe (test or live)
1. Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (not used by hosted Checkout but kept for future), `STRIPE_WEBHOOK_SECRET`; add `stripe` to `PAYMENT_PROVIDERS_ENABLED`.
2. Point a Stripe webhook endpoint at `https://<domain>/api/v1/payments/webhooks/stripe/` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `refund.updated`. Locally: `stripe listen --forward-to localhost:8080/api/v1/payments/webhooks/stripe/`.
3. Run a test-mode purchase end to end before going live; review tax, currency and refund policy with the business.

## Verified operating mode in this repository
Stripe signature verification, event application, idempotency and refunds are covered by automated tests that generate real HMAC-signed payloads and mock only the Stripe network calls. **No call to Stripe's servers (test or live) was made during development** — no credentials were available — so the Stripe adapter has not been exercised against Stripe itself. The sandbox adapter and cash are exercised end to end.
