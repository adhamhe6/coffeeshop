/** Query keys for the people / marketing / configuration admin pages (kept apart from the storefront `qk`). */
export interface ListParams {
  page?: number;
  search?: string;
  ordering?: string;
  [filter: string]: string | number | boolean | undefined;
}

export const ak = {
  customers: {
    all: ['admin', 'customers'] as const,
    list: (p: ListParams) => ['admin', 'customers', 'list', p] as const,
    detail: (id: number | string) => ['admin', 'customers', 'detail', String(id)] as const,
  },
  staff: {
    all: ['admin', 'staff'] as const,
    list: (p: ListParams) => ['admin', 'staff', 'list', p] as const,
    roles: ['admin', 'staff', 'roles'] as const,
  },
  branchOptions: ['admin', 'people', 'branch-options'] as const,
  coupons: {
    all: ['admin', 'coupons'] as const,
    list: (p: ListParams) => ['admin', 'coupons', 'list', p] as const,
    detail: (id: number | string) => ['admin', 'coupons', 'detail', String(id)] as const,
  },
  pickers: {
    categories: ['admin', 'coupon-pickers', 'categories'] as const,
    products: (q: string) => ['admin', 'coupon-pickers', 'products', q] as const,
    productsByIds: (ids: readonly number[]) =>
      ['admin', 'coupon-pickers', 'products-by-id', ids] as const,
  },
  content: {
    pages: ['admin', 'content', 'pages'] as const,
    blocks: ['admin', 'content', 'blocks'] as const,
    announcements: ['admin', 'content', 'announcements'] as const,
    social: ['admin', 'content', 'social'] as const,
    newsletter: (p: ListParams) => ['admin', 'content', 'newsletter', p] as const,
    newsletterAll: ['admin', 'content', 'newsletter'] as const,
  },
  settings: ['admin', 'settings'] as const,
  paymentMethods: ['admin', 'payment-methods'] as const,
  audit: {
    all: ['admin', 'audit'] as const,
    list: (p: ListParams) => ['admin', 'audit', 'list', p] as const,
  },
} as const;
