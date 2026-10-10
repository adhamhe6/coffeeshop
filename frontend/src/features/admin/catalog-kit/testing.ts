import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { staffMe } from '@/mocks/fixtures';
import type {
  AdminCategory,
  AdminCollection,
  AdminModifierGroup,
  AdminProduct,
  AdminProductRow,
  AdminReview,
  AdminTag,
} from '@/lib/api/adminCatalog';

/** Test-only helpers: staff identities and an in-memory fake of the catalogue admin API (MSW). */

const BASE = [
  'dashboard.view',
  'catalog.view',
  'orders.view',
  'inventory.view',
  'branches.view',
  'branches.manage',
  'inventory.manage',
  'reviews.moderate',
  'catalog.manage',
];
export const CAPS = {
  admin: BASE,
  productManager: [
    'dashboard.view',
    'catalog.view',
    'catalog.manage',
    'inventory.view',
    'reviews.moderate',
  ],
  orderManager: [
    'dashboard.view',
    'catalog.view',
    'inventory.view',
    'orders.view',
    'orders.manage',
  ],
  inventoryManager: [
    'dashboard.view',
    'catalog.view',
    'inventory.view',
    'inventory.manage',
    'branches.view',
  ],
  branchManager: [
    'dashboard.view',
    'catalog.view',
    'inventory.view',
    'inventory.manage',
    'branches.view',
    'branches.manage',
  ],
};

export function signInAs(capabilities: string[], branchIds: number[] | null = null) {
  state.me = {
    ...staffMe,
    staff: { ...staffMe.staff!, capabilities, branch_ids: branchIds },
  };
}

export const API = '/api/v1';
export const paged = <T>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
export const apiError = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
) =>
  HttpResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}), request_id: 'req-test' } },
    { status },
  );

export const productRow = (over: Partial<AdminProductRow> = {}): AdminProductRow => ({
  id: 1,
  slug: 'espresso',
  sku: 'LC-0101',
  name: 'Espresso',
  category: 1,
  category_name: 'Espresso',
  product_type: 'BEVERAGE',
  stock_mode: 'PREPARED',
  base_price: '3.00',
  image: null,
  is_active: true,
  is_featured: false,
  is_bestseller: false,
  is_seasonal: false,
  is_new: false,
  is_sold_out: false,
  sort_order: 1,
  stock_total: null,
  low_stock: false,
  is_demo: false,
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

export const product = (over: Partial<AdminProduct> = {}): AdminProduct => ({
  ...productRow(),
  short_description: '',
  description: '',
  gallery: [],
  prep_minutes: 5,
  calories: null,
  caffeine_mg: null,
  allergens: [],
  nutrition: {},
  tags: [],
  modifier_group_ids: [],
  modifier_groups: [],
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

export const category = (over: Partial<AdminCategory> = {}): AdminCategory => ({
  id: 1,
  name: 'Espresso',
  slug: 'espresso',
  description: '',
  image: null,
  sort_order: 1,
  is_active: true,
  is_featured: false,
  product_count: 2,
  active_product_count: 2,
  ...over,
});

export const group = (over: Partial<AdminModifierGroup> = {}): AdminModifierGroup => ({
  id: 1,
  name: 'Size (drinks)',
  display_name: 'Size',
  selection_type: 'SINGLE',
  is_required: true,
  min_select: 1,
  max_select: 1,
  sort_order: 1,
  is_active: true,
  product_count: 3,
  options: [
    {
      id: 1,
      name: 'Small',
      price_delta: '0.00',
      is_default: true,
      is_active: true,
      is_available: true,
      sort_order: 0,
    },
    {
      id: 2,
      name: 'Large',
      price_delta: '1.20',
      is_default: false,
      is_active: true,
      is_available: true,
      sort_order: 1,
    },
  ],
  ...over,
});

export const collection = (over: Partial<AdminCollection> = {}): AdminCollection => ({
  id: 1,
  name: 'Bestsellers',
  slug: 'bestsellers',
  description: '',
  image: null,
  is_active: true,
  is_featured: false,
  sort_order: 1,
  product_count: 0,
  product_ids: [],
  products: [],
  ...over,
});

export const review = (over: Partial<AdminReview> = {}): AdminReview => ({
  id: 1,
  product: { id: 1, name: 'Espresso', slug: 'espresso' },
  customer: { id: 9, name: 'Alex Morgan', email: 'alex@example.com' },
  order_number: 'DT-1',
  rating: 5,
  title: 'Great',
  body: 'Lovely',
  status: 'PENDING',
  is_demo: true,
  moderated_by: null,
  moderated_at: null,
  created_at: '2026-01-02T10:00:00Z',
  ...over,
});

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Registers handlers for the catalogue lists the pages read on load. Returns the request log so tests can assert
 * what was sent. Pass `overrides` to replace data, or call `server.use(...)` afterwards for custom behaviour.
 */
export function mockCatalogApi(
  data: {
    products?: AdminProductRow[];
    product?: AdminProduct;
    categories?: AdminCategory[];
    groups?: AdminModifierGroup[];
    collections?: AdminCollection[];
    tags?: AdminTag[];
  } = {},
) {
  const calls: Recorded[] = [];
  const log = async (request: Request) => {
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname.replace(API, ''),
      body,
    });
  };
  const products = data.products ?? [productRow()];
  server.use(
    http.get(`${API}/admin/products/`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q')?.toLowerCase();
      return HttpResponse.json(
        paged(q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products),
      );
    }),
    http.get(`${API}/admin/products/:id/`, ({ params }) =>
      data.product && String(data.product.id) === params.id
        ? HttpResponse.json(data.product)
        : apiError(404, 'not_found', 'Not found.'),
    ),
    http.get(`${API}/admin/categories/`, () =>
      HttpResponse.json(paged(data.categories ?? [category()])),
    ),
    http.get(`${API}/admin/modifier-groups/`, () =>
      HttpResponse.json(paged(data.groups ?? [group()])),
    ),
    http.get(`${API}/admin/collections/`, () => HttpResponse.json(paged(data.collections ?? []))),
    http.get(`${API}/admin/tags/`, () => HttpResponse.json(paged(data.tags ?? []))),
    http.get(`${API}/admin/inventory/availability/`, () => HttpResponse.json(paged([]))),
    http.get(`${API}/admin/inventory/stock/`, () => HttpResponse.json(paged([]))),
    http.get(`${API}/admin/branches/options/`, () =>
      HttpResponse.json([
        { id: 1, code: 'DT', name: 'Downtown', slug: 'downtown', is_active: true },
      ]),
    ),
  );
  return { calls, log };
}

// ── inventory & branches fixtures ────────────────────────────────────────
import type { AdminBranch, HoursEntry } from '@/lib/api/adminBranches';
import type { InventorySummary, StockItem } from '@/lib/api/adminInventory';

export const stockItem = (over: Partial<StockItem> = {}): StockItem => ({
  id: 1,
  branch: { id: 1, name: 'Downtown', code: 'DT' },
  product: { id: 61, name: 'Decaf Colombia', sku: 'LC-1107', slug: 'decaf-colombia', image: null },
  quantity: 8,
  low_stock_threshold: 6,
  is_low: false,
  unit_cost: '7.56',
  stock_value: '60.48',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

export const summary = (over: Partial<InventorySummary> = {}): InventorySummary => ({
  tracked_items: 4,
  low_stock_count: 0,
  out_of_stock_count: 0,
  valuation: '120.50',
  unvalued_items: 0,
  unavailable: [],
  ...over,
});

export const branch = (over: Partial<AdminBranch> = {}): AdminBranch => ({
  id: 1,
  code: 'DT',
  name: 'Downtown Flagship',
  slug: 'downtown-flagship',
  description: '',
  image: null,
  address_line: '100 Placeholder Avenue',
  city: 'Harbour City',
  postal_code: '00001',
  latitude: null,
  longitude: null,
  phone: '',
  email: '',
  timezone: 'America/New_York',
  is_active: true,
  is_placeholder_address: false,
  pickup_enabled: true,
  delivery_enabled: true,
  accepting_orders: true,
  prep_minutes: 10,
  sort_order: 1,
  is_open_now: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

export const weekHours = (): HoursEntry[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    is_closed: weekday === 6,
    opens: weekday === 6 ? null : '07:00:00',
    closes: weekday === 6 ? null : '18:00:00',
  }));
