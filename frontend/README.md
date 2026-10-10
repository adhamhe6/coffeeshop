# Lantern frontend

React 19 + TypeScript (strict, `noUncheckedIndexedAccess`) SPA for the storefront **and** the lazily-loaded admin dashboard.
Vite 7 · Tailwind CSS v4 (tokens in CSS `@theme`) · Radix primitives styled in-house (`src/design`) · TanStack Query v5 ·
React Router v7 (data router) · React Hook Form + Zod · Vitest + Testing Library + MSW · Playwright.

Design language, tokens, voice: [`docs/brand.md`](../docs/brand.md). Architecture/API contract: [`docs/implementation-plan.md`](../docs/implementation-plan.md).

## Run it

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173, proxies /api /media /django-admin /static /sitemap.xml /robots.txt → http://127.0.0.1:8000
npm run dev:mock       # same, but the API is served by MSW in the browser (no backend needed) — dev tooling only
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e       # Playwright (needs backend + vite running, see e2e/playwright.config.ts)
npm run format         # prettier (tailwind class sorting included)
npm run contrast       # prints the WCAG contrast table for every token pair
npm run gen:api        # regenerate src/lib/api/schema.d.ts from the running backend's OpenAPI
```

Backend for local dev: `cd backend && DATABASE_URL=postgres://coffee:coffee@127.0.0.1:5432/coffee_f ../.venv/bin/python manage.py runserver 8000`
(after `migrate` and `seed_demo`). Override the proxy target with `VITE_BACKEND_URL`, the API base with `VITE_API_BASE`.

`VITE_MOCK_API=1` starts an MSW service worker served by a dev-only Vite plugin (the worker file is **not** in `public/`).
The flag is a build-time constant, so the mock code is tree-shaken out of production builds (verified: no `msw` in `dist`).

Visual QA helper: `BASE_URL=http://127.0.0.1:5173 node scripts/screenshots.mjs ../docs/screenshots/foundation [routes…]`
(desktop 1440 / tablet 820 / mobile 390, full page, uses the preinstalled Chromium).

## Layout

```
src/
  app/                 providers.tsx (QueryClient, Money/Store bridge, Auth, Toaster, ErrorBoundary), auth.tsx (useAuth),
                       router.tsx (ALL routes, lazy), guards.tsx (RequireAuth/Staff/Capability), RootLayout.tsx (401 handler,
                       focus + title announcement on navigation, scroll restoration), layouts/{StorefrontLayout,AdminLayout}.tsx
  design/              the design system (barrel: `@/design`) — primitives only, no data fetching
  lib/api/             client.ts (fetch wrapper), errors.ts, keys.ts (query keys), types.ts (hand-written), schema.d.ts (generated),
                       one module per resource (auth, store, content, catalog, branches, cart, favorites, notifications, newsletter)
  lib/                 cn, seo, nav (safeNext, protected paths), hours, forms (applyApiErrors), favoritesStorage
  hooks/               useSeo, useFavorites, useMoney, useMediaQuery, useDebouncedValue
  features/<area>/     pages/ (one file per route, default export) + components/ for that area
      storefront/ (home sections, header/footer/search/mobile nav, CMS pages)  account/ (auth pages)  catalog/ (ProductCard, favourites)
      cart/ (cart sheet/button)  checkout/ orders/ (placeholders)  admin/<area>/pages (placeholders) + admin/nav.ts
  mocks/               MSW handlers + fixtures (used by tests and `dev:mock`)
  test/                setup.ts (jsdom polyfills, matchMedia), utils.tsx (renderApp, renderWithProviders, axe helper)
e2e/                   Playwright config + smoke spec
```

Path alias: `@/` → `src/`.

## Conventions

- **One file per route** under `src/features/<area>/pages/XPage.tsx`, default-exported component. `app/router.tsx` lazy-loads each, so every page is its own chunk
  and the whole `/admin` area (layout + pages) is a separate lazy chunk. Placeholder pages render `TodoPage` — **replace the file's body, not the router entry**.
- **Server state = TanStack Query**; keys come from `qk` in `lib/api/keys.ts` — never inline key arrays. **Forms = RHF + Zod** (`zodResolver`), server field errors mapped with `applyApiErrors`.
  UI state is local or in the URL (filters, pagination → search params).
- **Design tokens, not hex**: use semantic utilities (`bg-surface-raised`, `text-text-muted`, `border-border-strong`, `text-accent-text`). Use `text-accent-text`, not `text-accent`, for copper _text_
  (contrast). Dark feature surfaces: add `data-surface="dark"` (flips the focus ring) and use `text-text-inverse(-muted)`, `text-accent-on-dark`.
- **Money** is a decimal _string_ from the API; render with `<Money value="4.50" />` or `useMoney().format(v)` (currency from `store/`). Never do arithmetic on money in the UI beyond display; totals come from the API.
- **Images**: `<ProductImage src={api.image} alt="" aspect="4/5" />` — handles root-relative `/media/…`, null, errors, lazy loading, CLS. `priority` only for above-the-fold.
- **Accessibility**: every interactive component is keyboard operable with a visible `:focus-visible` ring; icon-only buttons need `IconButton label=…`; status = icon + text; dialogs need titles
  (`DialogContent title=…`); headings: one `h1` per page. Use `useSeo` on every page (`noindex` for private pages).
- **No remote requests**: fonts are self-hosted, no CDN. The e2e smoke test fails on any cross-origin request.
- **CMS content**: markdown only through `<Prose>` (no raw HTML, `javascript:` URLs stripped, external links get `rel="noopener noreferrer"`). CMS links go through `<SmartLink to=…>`.
- **Auth/CSRF**: session cookies; `lib/api/client.ts` primes `auth/csrf/` and sends `X-CSRFToken` (cookie `lantern_csrftoken`) on unsafe methods and retries once on a stale token.
  A 401 anywhere clears the cached identity and, on a protected path, redirects to `/login?next=…` (`RootLayout`). Calls that expect 401 pass `skipUnauthorizedEvent`.
  Redirect targets are always passed through `safeNext()`.
- **Idempotency**: `api.post('checkout/', body, { idempotencyKey })` with a key from `newIdempotencyKey()`; create the key once per checkout attempt and reuse it on retries.

## How to…

### Add a page

1. Edit the placeholder (or create) `src/features/<area>/pages/MyPage.tsx` with `export default function MyPage()`.
2. If it is a new route, add it to `src/app/router.tsx` with `lazy: page(() => import('…'))` (use `customer(…)` for signed-in-only pages, `adminPage(path, …)` for admin).
3. Call `useSeo({ title, description, … })`; wrap data in loading (Skeleton) / error (`ErrorState` with `onRetry`) / empty (`EmptyState`) states.

### Add a query / mutation

```ts
// src/lib/api/orders.ts
export const ordersApi = {
  list: (page = 1) => api.get<Paginated<Order>>('orders/', { query: { page } }),
};
export const useOrders = (page = 1) =>
  useQuery({ queryKey: qk.orders.list(page), queryFn: () => ordersApi.list(page) });
```

Add the key to `keys.ts`, export from `lib/api/index.ts`. Mutations: `useMutation` + `qc.invalidateQueries({ queryKey: qk.orders.all })`; for instant feedback follow the optimistic pattern in `cart.ts`.
User-owned data keys go in `userScopedKeys` so logout / 401 wipes them. Errors are `ApiError` (`status`, `code`, `message`, `fields`, `requestId`, `extra`).

### Add a form

```tsx
const schema = z.object({ email: z.string().trim().email('Enter a valid email address.') });
const {
  register,
  handleSubmit,
  setError,
  formState: { errors, isSubmitting },
} = useForm({ resolver: zodResolver(schema) });
const onSubmit = handleSubmit(async (v) => {
  try {
    await mutateAsync(v);
  } catch (e) {
    setFormError(applyApiErrors(e, setError, ['email']));
  }
});
<Field label="Email" required error={errors.email?.message}>
  <Input type="email" {...register('email')} />
</Field>;
```

`Field` wires `id`, `aria-describedby`, `aria-invalid`, `required` into `Input`/`Textarea`/`Select`. Show form-level errors with `FormAlert`. See `features/account/pages/RegisterPage.tsx`.

### Add an admin page

Add the entry (label, path, icon, **capability**) to `features/admin/nav.ts` — the sidebar and the route guard both read it — then build
`features/admin/<area>/pages/…`. Use `DataTable` (server-side sorting via `toOrdering`/`fromOrdering`, `Pagination`), `Stat`, `StatusBadge`. Admin pages sit inside `data-theme="admin"` (dense, neutral).
`useAuth().hasCapability('orders.manage')` hides actions; the backend enforces regardless.

### Regenerate API types

Start the backend, then `npm run gen:api` (writes `src/lib/api/schema.d.ts`, committed). `types.ts` stays hand-written for ergonomics, and
`src/lib/api/types.check.ts` fails `npm run typecheck` if the backend schema stops being assignable to those types. For new endpoints prefer
`components['schemas']['…']` and `paths[…]` from `schema.d.ts`.

## Tests

`npm test` (Vitest, jsdom, MSW in `onUnhandledRequest: 'error'` mode — add a handler for every endpoint a test touches).

- Component tests: `renderInRouter(ui)`; pages/app: `renderWithProviders(ui, { route })` or `renderApp('/login')` (real route table). Call `resetTestWorld()` in `beforeEach`.
- Override an endpoint for one test: `server.use(http.get('/api/v1/products/', …))`. Mutable fake backend state is `state` in `src/mocks/handlers.ts` (`state.me = customerMe` to sign in).
- `expectNoA11yViolations(container)` runs axe-core (contrast is covered by the token tests, since jsdom has no layout).
- Responsive logic: `window.innerWidth = 390` before render (the `matchMedia` polyfill evaluates `min/max-width`).
- Radix radios/tabs: arrow keys move **focus**; selection of radios needs Space in jsdom (see `design.test.tsx`).
- E2E: `e2e/smoke.spec.ts` (home, auth pages, 404, skip link, no console errors, no third-party requests) — `E2E_BASE_URL`, `E2E_CHROMIUM_PATH` env vars supported.

## State of the API assumptions

The foundation was verified against the live backend schema (`gen:api` + `types.check.ts`). Things to know:
`auth/me/` returns 200 even for anonymous visitors (`authenticated:false`); login returns the same shape, registration returns only the user (we re-read `me`);
unread notification count comes with `me` (`unread_notifications`); `content/blocks/` is an object keyed by block key; cart lines are posted as
`{ product_id, quantity, option_ids, note }`; favourites are `favorites/ids/` → `{ids}`, `favorites/merge/` ← `{product_ids}`.

## Bundle (gzip, production build)

Initial load: `index` 24 kB + `react` 102 kB + `query` 10 kB + `radix` 32 kB + `vendor` 30 kB + `forms` 25 kB + CSS 13 kB. Lazy: home page 9 kB, markdown/Prose 46 kB
(only CMS pages), auth pages 1–2 kB each, admin layout 2 kB, recharts reserved in its own `charts` chunk for admin. Source maps are emitted (`build.sourcemap`).
