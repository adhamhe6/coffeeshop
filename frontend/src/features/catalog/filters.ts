import type { ProductListParams, ProductType } from '@/lib/api/types';
import type { CatalogParams } from './api';

/**
 * Menu / search filter state. It lives in the URL (so links, back/forward and reloads all work) and maps 1:1 to the
 * `products/` query parameters:  ?q=&type=&tag=&min_price=&max_price=&seasonal=&bestseller=&new=&ordering=&page=
 * The category is part of the path (`/menu/:category`).
 */
export interface MenuFilters {
  q: string;
  /** Category slug as a query parameter. Used by /search only; /menu/:category carries it in the path. */
  category: string;
  type: ProductType | '';
  tag: string;
  minPrice: string;
  maxPrice: string;
  seasonal: boolean;
  bestseller: boolean;
  isNew: boolean;
  ordering: Ordering | '';
  page: number;
}

export type Ordering = NonNullable<ProductListParams['ordering']>;

export const PRODUCT_TYPES: ProductType[] = ['BEVERAGE', 'FOOD', 'BEANS', 'MERCH', 'GIFT'];
export const ORDERINGS: Ordering[] = [
  'menu',
  'relevance',
  'popularity',
  'newest',
  'price',
  '-price',
  'name',
  '-name',
];

export const ORDERING_LABELS: Record<Ordering, string> = {
  menu: 'Menu order',
  relevance: 'Best match',
  popularity: 'Bestsellers first',
  newest: 'Newest first',
  price: 'Price: low to high',
  '-price': 'Price: high to low',
  name: 'Name: A to Z',
  '-name': 'Name: Z to A',
};

export const PAGE_SIZE = 24;

const money = /^\d{1,6}(\.\d{1,2})?$/;
const slugOr = (v: string | null) => (v && /^[-a-zA-Z0-9_]+$/.test(v) ? v : '');
const isTrue = (v: string | null) => v === 'true' || v === '1';

export const EMPTY_FILTERS: MenuFilters = {
  q: '',
  category: '',
  type: '',
  tag: '',
  minPrice: '',
  maxPrice: '',
  seasonal: false,
  bestseller: false,
  isNew: false,
  ordering: '',
  page: 1,
};

/** Read filters from the URL, ignoring anything malformed (the API would answer 400 for it). */
export function parseFilters(params: URLSearchParams): MenuFilters {
  const type = params.get('type') ?? '';
  const ordering = params.get('ordering') ?? '';
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  const min = params.get('min_price') ?? '';
  const max = params.get('max_price') ?? '';
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    category: slugOr(params.get('category')),
    type: (PRODUCT_TYPES as string[]).includes(type) ? (type as ProductType) : '',
    tag: slugOr(params.get('tag')),
    minPrice: money.test(min) ? min : '',
    maxPrice: money.test(max) ? max : '',
    seasonal: isTrue(params.get('seasonal')),
    bestseller: isTrue(params.get('bestseller')),
    isNew: isTrue(params.get('new')),
    ordering: (ORDERINGS as string[]).includes(ordering) ? (ordering as Ordering) : '',
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** Serialise filters to a clean query string (defaults are omitted, so `/menu` stays `/menu`). */
export function filtersToSearch(filters: Partial<MenuFilters>): string {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.category) p.set('category', filters.category);
  if (filters.type) p.set('type', filters.type);
  if (filters.tag) p.set('tag', filters.tag);
  if (filters.minPrice) p.set('min_price', filters.minPrice);
  if (filters.maxPrice) p.set('max_price', filters.maxPrice);
  if (filters.seasonal) p.set('seasonal', 'true');
  if (filters.bestseller) p.set('bestseller', 'true');
  if (filters.isNew) p.set('new', 'true');
  if (filters.ordering) p.set('ordering', filters.ordering);
  if (filters.page && filters.page > 1) p.set('page', String(filters.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Apply a change; anything except paging resets to page 1. */
export function withFilters(current: MenuFilters, patch: Partial<MenuFilters>): MenuFilters {
  const next = { ...current, ...patch };
  if (!('page' in patch)) next.page = 1;
  return next;
}

/** Number of active narrowing filters (search text, ordering and page do not count). */
export function activeFilterCount(f: MenuFilters): number {
  return (
    Number(Boolean(f.category)) +
    Number(Boolean(f.type)) +
    Number(Boolean(f.tag)) +
    Number(Boolean(f.minPrice)) +
    Number(Boolean(f.maxPrice)) +
    Number(f.seasonal) +
    Number(f.bestseller) +
    Number(f.isNew)
  );
}

export const hasNarrowing = (f: MenuFilters) => activeFilterCount(f) > 0;

/** Request parameters for `products/` and `products/facets/`. */
export function toApiParams(
  filters: MenuFilters,
  opts: { category?: string; branch?: string; pageSize?: number } = {},
): CatalogParams {
  const params: CatalogParams = {};
  if (filters.q) params.q = filters.q;
  const category = opts.category ?? filters.category;
  if (category) params.category = category;
  if (filters.type) params.type = filters.type;
  if (filters.tag) params.tag = filters.tag;
  if (filters.minPrice) params.min_price = filters.minPrice;
  if (filters.maxPrice) params.max_price = filters.maxPrice;
  if (filters.seasonal) params.seasonal = true;
  if (filters.bestseller) params.bestseller = true;
  if (filters.isNew) params.new = true;
  if (filters.ordering) params.ordering = filters.ordering;
  if (opts.branch) params.branch = opts.branch;
  params.page_size = opts.pageSize ?? PAGE_SIZE;
  if (filters.page > 1) params.page = filters.page;
  return params;
}

export interface FilterChip {
  key: string;
  label: string;
  /** Filters with this chip removed. */
  clear: Partial<MenuFilters>;
}

/** Chips for active filters; labels come from facet data when available. */
export function filterChips(
  f: MenuFilters,
  lookup: {
    categoryLabel: (slug: string) => string;
    typeLabel: (value: string) => string;
    tagLabel: (slug: string) => string;
    formatPrice: (value: string) => string;
  },
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.category)
    chips.push({
      key: 'category',
      label: lookup.categoryLabel(f.category),
      clear: { category: '' },
    });
  if (f.type) chips.push({ key: 'type', label: lookup.typeLabel(f.type), clear: { type: '' } });
  if (f.tag) chips.push({ key: 'tag', label: lookup.tagLabel(f.tag), clear: { tag: '' } });
  if (f.seasonal) chips.push({ key: 'seasonal', label: 'Seasonal', clear: { seasonal: false } });
  if (f.bestseller)
    chips.push({ key: 'bestseller', label: 'Bestsellers', clear: { bestseller: false } });
  if (f.isNew) chips.push({ key: 'new', label: 'New', clear: { isNew: false } });
  if (f.minPrice || f.maxPrice) {
    const label =
      f.minPrice && f.maxPrice
        ? `${lookup.formatPrice(f.minPrice)} – ${lookup.formatPrice(f.maxPrice)}`
        : f.minPrice
          ? `From ${lookup.formatPrice(f.minPrice)}`
          : `Up to ${lookup.formatPrice(f.maxPrice)}`;
    chips.push({ key: 'price', label, clear: { minPrice: '', maxPrice: '' } });
  }
  return chips;
}

export const CLEARED: Partial<MenuFilters> = {
  category: '',
  type: '',
  tag: '',
  minPrice: '',
  maxPrice: '',
  seasonal: false,
  bestseller: false,
  isNew: false,
};

/** "Clean" tag slug → label ("oat-friendly" → "Oat friendly") for tags the facets did not name. */
export const humanize = (slug: string) =>
  slug.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
