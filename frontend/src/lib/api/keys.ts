import type { ProductListParams } from './types';

/**
 * Query-key factory. Always build keys here so invalidation stays predictable:
 *   qc.invalidateQueries({ queryKey: qk.products.all })  // every product query
 *   qc.invalidateQueries({ queryKey: qk.products.list(p) }) // one list
 */
export const qk = {
  auth: { me: ['auth', 'me'] as const },
  store: ['store'] as const,
  content: {
    all: ['content'] as const,
    blocks: ['content', 'blocks'] as const,
    page: (slug: string) => ['content', 'page', slug] as const,
  },
  categories: { all: ['categories'] as const },
  products: {
    all: ['products'] as const,
    list: (params: ProductListParams = {}) => ['products', 'list', params] as const,
    detail: (slug: string) => ['products', 'detail', slug] as const,
    suggest: (q: string) => ['products', 'suggest', q] as const,
  },
  collections: {
    all: ['collections'] as const,
    detail: (slug: string) => ['collections', 'detail', slug] as const,
  },
  branches: {
    all: ['branches'] as const,
    detail: (slug: string) => ['branches', 'detail', slug] as const,
  },
  cart: ['cart'] as const,
  favorites: {
    all: ['favorites'] as const,
    ids: ['favorites', 'ids'] as const,
    list: ['favorites', 'list'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    unread: ['notifications', 'unread'] as const,
    list: (page = 1, unreadOnly = false) => ['notifications', 'list', page, unreadOnly] as const,
  },
  orders: {
    all: ['orders'] as const,
    list: (params: { page?: number; status?: string | readonly string[] } = {}) =>
      ['orders', 'list', params] as const,
    detail: (number: string) => ['orders', 'detail', number] as const,
  },
  addresses: ['addresses'] as const,
  checkout: {
    all: ['checkout'] as const,
    methods: ['checkout', 'methods'] as const,
    zones: ['checkout', 'zones'] as const,
    slots: (branch: string, type: string, date: string) =>
      ['checkout', 'slots', branch, type, date] as const,
    demoPayment: (reference: string) => ['checkout', 'demo-payment', reference] as const,
  },
} as const;

/** Keys that hold data belonging to the signed-in customer (wiped on logout / 401). */
export const userScopedKeys = [
  qk.cart,
  qk.favorites.all,
  qk.notifications.all,
  qk.orders.all,
  qk.addresses,
  qk.checkout.all,
] as const;
