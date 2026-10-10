# Operations

## Environments
`config.settings.dev` (debug, console email), `test` (locmem cache, eager Celery, fast hasher), `prod` (fails fast on weak `DJANGO_SECRET_KEY`, wildcard hosts, missing Stripe keys; HTTPS redirect, HSTS, secure cookies, demo payments off by default).

## Running
- Docker: `cp .env.example .env && docker compose up --build` → storefront on `http://localhost:8080`. First boot with `SEED_DEMO=1` loads the demo catalogue.
- Local: see README (PostgreSQL + Redis + `manage.py runserver` + `npm run dev`).
- Health: `GET /api/v1/health/live/` (process), `/api/v1/health/ready/` and `/healthz` (DB required → 503 on failure; Redis failure reports `degraded` with 200).

## Logging
Structured logs (set `LOG_JSON=true`), every line carries the request id (`X-Request-ID` is accepted if well-formed and echoed back). Events: auth failures, order placement/transitions, payment events, refunds, stock movements, admin changes (also in the `AuditLog` table, which is append-only), background-task outcomes. Passwords, tokens, card data and webhook secrets are never logged.

## Backups and recovery (deployment responsibilities)
PostgreSQL is the only stateful store that matters (media files are the second: `media` volume). Schedule `pg_dump`/WAL archiving and volume snapshots; test restores. Redis may be flushed at any time without data loss (carts are in PostgreSQL).

## Reset / reseed
`python manage.py seed_demo --reset-demo` deletes only rows flagged `is_demo` (and demo users) and re-seeds. Demo accounts are **development-only** (see `seed-data.md`); never seed production with them.

## Failure behaviour (verified by running the purchase flow against a live server)
| Failure | Observed behaviour |
|---|---|
| Redis down (cache, throttles, broker) | Entire register → customise → checkout → pay → staff fulfilment → dashboard flow still passes (`scripts/api_smoke.py` against a server whose Redis was shut down). `/health/ready` reports `degraded` (HTTP 200). Throttling is not enforced while Redis is down (fails open). Notification emails that could not be enqueued are recorded `email_status=failed` and are **not** automatically re-sent when Redis returns (in-app notifications are unaffected). |
| PostgreSQL down | `/health/ready` and `/healthz` return 503; API calls return the generic 500 envelope with a request id (no stack trace). No partial orders: all order/payment/stock writes are transactional. |
| Celery worker down | Requests are unaffected (tasks are queued in Redis). Unpaid-order expiry, reconciliation and email delivery resume when workers return. |
| Stripe webhook lost | `reconcile_open_payments` (every 10 min) retrieves open sessions from Stripe; the return page also calls the sync endpoint. |
