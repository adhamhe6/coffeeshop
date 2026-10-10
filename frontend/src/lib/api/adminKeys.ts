/**
 * Query keys for the catalogue / stock half of the staff dashboard. Prefixed with `admin` so they never collide
 * with the storefront keys in `keys.ts` (the storefront keys are invalidated separately after writes so the
 * public site never serves stale prices).
 */
type Params = Record<string, string | number | boolean | undefined>;

export const aqk = {
  products: {
    all: ['admin', 'products'] as const,
    list: (p: Params = {}) => ['admin', 'products', 'list', p] as const,
    detail: (id: number | string) => ['admin', 'products', 'detail', String(id)] as const,
  },
  categories: { all: ['admin', 'categories'] as const },
  groups: { all: ['admin', 'modifier-groups'] as const },
  collections: { all: ['admin', 'collections'] as const },
  tags: { all: ['admin', 'tags'] as const },
  reviews: {
    all: ['admin', 'reviews'] as const,
    list: (p: Params = {}) => ['admin', 'reviews', 'list', p] as const,
  },
  inventory: {
    all: ['admin', 'inventory'] as const,
    summary: (branch?: number | string) =>
      ['admin', 'inventory', 'summary', branch ?? 'all'] as const,
    stock: (p: Params = {}) => ['admin', 'inventory', 'stock', p] as const,
    movements: (p: Params = {}) => ['admin', 'inventory', 'movements', p] as const,
    availability: (p: Params = {}) => ['admin', 'inventory', 'availability', p] as const,
  },
  branches: {
    all: ['admin', 'branches'] as const,
    options: ['admin', 'branches', 'options'] as const,
    list: ['admin', 'branches', 'list'] as const,
    detail: (id: number | string) => ['admin', 'branches', 'detail', String(id)] as const,
    hours: (id: number | string) => ['admin', 'branches', 'hours', String(id)] as const,
    closures: (id: number | string) => ['admin', 'branches', 'closures', String(id)] as const,
    zones: (id: number | string) => ['admin', 'branches', 'zones', String(id)] as const,
    staff: (id: number | string) => ['admin', 'branches', 'staff', String(id)] as const,
  },
  zones: { all: ['admin', 'delivery-zones'] as const },
} as const;
