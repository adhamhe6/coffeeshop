import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import * as fx from '@/mocks/fixtures';
import type { CartItem, ModifierGroup, ProductDetail } from '@/lib/api/types';

/** Test-only API doubles for the catalogue: records every request body/query so tests can assert on them. */

export const sizeGroup: ModifierGroup = {
  id: 1,
  display_name: 'Size',
  selection_type: 'SINGLE',
  is_required: true,
  min_select: 1,
  max_select: 1,
  options: [
    { id: 1, name: 'Small', price_delta: '0.00', is_default: true, is_available: true },
    { id: 2, name: 'Large', price_delta: '0.75', is_default: false, is_available: true },
  ],
};
export const milkGroup: ModifierGroup = {
  id: 2,
  display_name: 'Milk',
  selection_type: 'SINGLE',
  is_required: false,
  min_select: 0,
  max_select: 1,
  options: [
    { id: 3, name: 'Whole milk', price_delta: '0.00', is_default: true, is_available: true },
    { id: 4, name: 'Oat milk', price_delta: '0.60', is_default: false, is_available: true },
  ],
};
export const shotsGroup: ModifierGroup = {
  id: 3,
  display_name: 'Extra shots',
  selection_type: 'MULTIPLE',
  is_required: false,
  min_select: 0,
  max_select: 2,
  options: [
    { id: 5, name: 'Espresso shot', price_delta: '0.90', is_default: false, is_available: true },
    { id: 6, name: 'Ristretto shot', price_delta: '0.90', is_default: false, is_available: true },
    { id: 7, name: 'Decaf shot', price_delta: '0.90', is_default: false, is_available: true },
  ],
};
/** Required MULTIPLE group with no default: the product starts out invalid. */
export const toppingGroup: ModifierGroup = {
  id: 4,
  display_name: 'Topping',
  selection_type: 'MULTIPLE',
  is_required: true,
  min_select: 1,
  max_select: 2,
  options: [
    { id: 8, name: 'Cocoa', price_delta: '0.00', is_default: false, is_available: true },
    { id: 9, name: 'Cinnamon', price_delta: '0.00', is_default: false, is_available: true },
  ],
};

export function detailFor(slug: string, groups: ModifierGroup[]): ProductDetail | undefined {
  const base = fx.productDetail(slug);
  if (!base) return undefined;
  return {
    ...base,
    modifier_groups: groups,
    allergens: ['milk'],
    calories: 190,
    caffeine_mg: 128,
    nutrition: { serving_size: 'Small (8 fl oz)' },
    reviews: {
      average: 4,
      count: 2,
      distribution: [
        { rating: 5, count: 1 },
        { rating: 4, count: 0 },
        { rating: 3, count: 1 },
        { rating: 2, count: 0 },
        { rating: 1, count: 0 },
      ],
    },
  };
}

export interface Recorded {
  quotes: Array<Record<string, unknown>>;
  cartPosts: Array<Record<string, unknown>>;
  cartPatches: Array<{ id: number; body: Record<string, unknown> }>;
  productQueries: URLSearchParams[];
  detailQueries: URLSearchParams[];
  reviewPosts: Array<Record<string, unknown>>;
  favoritePosts: Array<Record<string, unknown>>;
  favoriteDeletes: number[];
}

export interface CatalogMockOptions {
  groups?: ModifierGroup[];
  eligibility?: { can_review: boolean; reason: string | null };
  /** Slugs unavailable at a given branch slug. */
  unavailableAt?: Record<string, string[]>;
}

export function installCatalogMocks(options: CatalogMockOptions = {}): Recorded {
  const groups = options.groups ?? [sizeGroup, milkGroup, shotsGroup];
  const rec: Recorded = {
    quotes: [],
    cartPosts: [],
    cartPatches: [],
    productQueries: [],
    detailQueries: [],
    reviewPosts: [],
    favoritePosts: [],
    favoriteDeletes: [],
  };

  const optionIndex = new Map(groups.flatMap((g) => g.options.map((o) => [o.id, { g, o }])));

  server.use(
    http.get('/api/v1/products/facets/', () =>
      HttpResponse.json({
        categories: fx.categories.map((c) => ({
          slug: c.slug,
          name: c.name,
          count: c.product_count,
        })),
        tags: [{ slug: 'vegan', name: 'vegan', count: 3 }],
        types: [
          { value: 'BEVERAGE', label: 'Beverage', count: 8 },
          { value: 'BEANS', label: 'Coffee beans', count: 3 },
        ],
        price: { min: '3.00', max: '38.00' },
      }),
    ),
    http.get('/api/v1/products/', ({ request }) => {
      const params = new URL(request.url).searchParams;
      rec.productQueries.push(params);
      let list = [...fx.products];
      const q = params.get('q')?.toLowerCase();
      if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
      const type = params.get('type');
      if (type) list = list.filter((p) => p.product_type === type);
      if (params.get('seasonal') === 'true') list = list.filter((p) => p.flags?.is_seasonal);
      if (params.get('bestseller') === 'true') list = list.filter((p) => p.flags?.is_bestseller);
      const category = params.get('category');
      if (category) list = list.filter((p) => p.category?.slug === category);
      const ids = params.get('ids');
      if (ids) {
        const wanted = new Set(ids.split(',').map(Number));
        list = list.filter((p) => wanted.has(p.id));
      }
      const branch = params.get('branch');
      const blocked = (branch && options.unavailableAt?.[branch]) || [];
      list = list.map((p) =>
        blocked.includes(p.slug)
          ? { ...p, is_available: false, unavailable_reason: 'branch_unavailable' as const }
          : p,
      );
      return HttpResponse.json({ count: list.length, next: null, previous: null, results: list });
    }),
    http.get('/api/v1/products/:slug/', ({ params, request }) => {
      rec.detailQueries.push(new URL(request.url).searchParams);
      const detail = detailFor(String(params.slug), groups);
      return detail
        ? HttpResponse.json(detail)
        : HttpResponse.json(
            { error: { code: 'not_found', message: 'Not found.', request_id: 'r' } },
            { status: 404 },
          );
    }),
    http.post('/api/v1/products/:slug/quote/', async ({ request }) => {
      const body = (await request.json()) as { option_ids: number[]; quantity: number };
      rec.quotes.push(body);
      const picked = body.option_ids.map((id) => optionIndex.get(id)).filter(Boolean) as Array<{
        g: ModifierGroup;
        o: ModifierGroup['options'][number];
      }>;
      const unit = 4.5 + picked.reduce((n, { o }) => n + Number(o.price_delta), 0);
      const errors = groups
        .filter((g) => g.is_required && !picked.some((p) => p.g.id === g.id))
        .map((g) => ({
          code: 'required_group',
          message: `Please choose an option for ${g.display_name}.`,
          group: g.display_name,
        }));
      return HttpResponse.json({
        base_price: '4.50',
        unit_price: unit.toFixed(2),
        quantity: body.quantity,
        options: picked.map(({ g, o }) => ({
          group: g.display_name,
          name: o.name,
          price_delta: o.price_delta,
        })),
        line_total: (unit * body.quantity).toFixed(2),
        currency: 'USD',
        valid: errors.length === 0,
        errors,
      });
    }),
    http.get('/api/v1/products/:slug/reviews/eligibility/', () =>
      HttpResponse.json(options.eligibility ?? { can_review: false, reason: 'login_required' }),
    ),
    http.get('/api/v1/products/:slug/reviews/', () =>
      HttpResponse.json({
        count: 2,
        next: null,
        previous: null,
        results: [
          {
            id: 1,
            rating: 5,
            title: 'Perfect',
            body: 'Silky and sweet.',
            author: 'Sam K.',
            verified_purchase: true,
            is_demo: true,
            created_at: '2026-08-01T10:00:00Z',
          },
          {
            id: 2,
            rating: 3,
            title: 'Fine',
            body: 'Real customer note.',
            author: 'Jo P.',
            verified_purchase: false,
            is_demo: false,
            created_at: '2026-08-02T10:00:00Z',
          },
        ],
      }),
    ),
    http.post('/api/v1/products/:slug/reviews/', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      rec.reviewPosts.push(body);
      return HttpResponse.json(
        {
          id: 9,
          rating: body.rating,
          title: body.title ?? '',
          body: body.body ?? '',
          author: 'Alex M.',
          verified_purchase: true,
          is_demo: false,
          created_at: '2026-10-10T10:00:00Z',
          status: 'PENDING',
        },
        { status: 201 },
      );
    }),
    http.post('/api/v1/cart/items/', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      rec.cartPosts.push(body);
      const product = fx.products.find((p) => p.id === body.product_id);
      state.cart.push({
        id: state.nextLine++,
        quantity: Number(body.quantity),
        unit_price: product?.base_price ?? '0.00',
        line_total: product?.base_price ?? '0.00',
        note: String(body.note ?? ''),
        product: {
          id: product?.id ?? 0,
          slug: product?.slug ?? '',
          name: product?.name ?? '',
          image: null,
          is_available: true,
        },
        options: [],
        issues: [],
        price_changed: null,
      });
      return HttpResponse.json(cartBody(), { status: 201 });
    }),
    http.patch('/api/v1/cart/items/:id/', async ({ params, request }) => {
      rec.cartPatches.push({
        id: Number(params.id),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(cartBody());
    }),
    http.post('/api/v1/favorites/', async ({ request }) => {
      const body = (await request.json()) as { product_id: number };
      rec.favoritePosts.push(body);
      state.favorites.add(body.product_id);
      return HttpResponse.json(body, { status: 201 });
    }),
    http.delete('/api/v1/favorites/:id/', ({ params }) => {
      rec.favoriteDeletes.push(Number(params.id));
      state.favorites.delete(Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/v1/favorites/', () => {
      const results = fx.products.filter((p) => state.favorites.has(p.id));
      return HttpResponse.json({ count: results.length, next: null, previous: null, results });
    }),
  );
  return rec;
}

function cartBody() {
  return {
    items: state.cart,
    item_count: state.cart.reduce((n, i) => n + i.quantity, 0),
    subtotal: state.cart.reduce((n, i) => n + Number(i.line_total), 0).toFixed(2),
    currency: 'USD',
    issues: [],
    branch_id: null,
  };
}

/** A cart line for `/p/flat-white?edit=…` tests (option snapshots carry names, not ids). */
export function cartLine(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 5,
    quantity: 2,
    unit_price: '5.25',
    line_total: '10.50',
    note: 'Extra hot',
    product: { id: 1, slug: 'flat-white', name: 'Flat White', image: null, is_available: true },
    options: [
      { group: 'Size', name: 'Large', price_delta: '0.75' },
      { group: 'Milk', name: 'Oat milk', price_delta: '0.60' },
      { group: 'Extra shots', name: 'Espresso shot', price_delta: '0.90' },
    ],
    issues: [],
    price_changed: null,
    ...overrides,
  };
}
