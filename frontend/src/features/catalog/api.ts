import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/app/auth';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import type {
  Cart,
  Paginated,
  ProductDetail,
  ProductListParams,
  ProductSummary,
} from '@/lib/api/types';

/**
 * Catalogue-specific API calls and hooks (facets, quote, reviews, branch-aware detail, favourites list, cart
 * re-configuration). Everything lives under the `['products', …]` key prefix so `qk.products.all` invalidates it.
 */

// ── Types (see /api/v1/schema/: Facets, Quote, Review, ReviewEligibility) ──
export interface FacetCount {
  slug: string;
  name: string;
  count: number;
}
export interface Facets {
  categories: FacetCount[];
  tags: FacetCount[];
  types: Array<{ value: string; label: string; count: number }>;
  price: { min: string | null; max: string | null };
}

export interface QuoteError {
  code: string;
  message: string;
  group?: string;
}
export interface Quote {
  unit_price: string;
  base_price: string;
  quantity: number;
  options: Array<{ group: string; name: string; price_delta: string }>;
  line_total: string;
  currency: string;
  valid: boolean;
  errors: QuoteError[];
}
/** Body of `products/{slug}/quote/`: configuration only, never a price. */
export interface QuoteRequest {
  option_ids: number[];
  quantity: number;
  branch_id?: number | null;
}

export interface Review {
  id: number;
  rating: number;
  title: string;
  body: string;
  author: string;
  verified_purchase: boolean;
  /** Seeded demonstration review, not genuine customer feedback. */
  is_demo: boolean;
  created_at: string;
}
export interface OwnReview extends Review {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}
export type ReviewEligibilityReason =
  'login_required' | 'reviews_disabled' | 'not_purchased' | 'already_reviewed';
export interface ReviewEligibility {
  can_review: boolean;
  reason: ReviewEligibilityReason | null;
}
export interface ReviewInput {
  rating: number;
  title?: string;
  body?: string;
}

/** List filters accepted by `products/` (the generated type predates `ids`). */
export type CatalogParams = ProductListParams & { ids?: string };

type QueryRecord = Record<string, string | number | boolean>;
const toQuery = (params: object) => params as QueryRecord;

export const catalogExtras = {
  facets: (params: CatalogParams, signal?: AbortSignal) =>
    api.get<Facets>('products/facets/', { query: toQuery(params), signal }),
  products: (params: CatalogParams, signal?: AbortSignal) =>
    api.get<Paginated<ProductSummary>>('products/', { query: toQuery(params), signal }),
  detail: (slug: string, branch: string | undefined, signal?: AbortSignal) =>
    api.get<ProductDetail>(`products/${encodeURIComponent(slug)}/`, {
      query: branch ? { branch } : undefined,
      signal,
    }),
  quote: (slug: string, body: QuoteRequest, signal?: AbortSignal) =>
    api.post<Quote>(`products/${encodeURIComponent(slug)}/quote/`, body, { signal }),
  reviews: (slug: string, page: number) =>
    api.get<Paginated<Review>>(`products/${encodeURIComponent(slug)}/reviews/`, {
      query: { page, page_size: 5 },
    }),
  eligibility: (slug: string) =>
    api.get<ReviewEligibility>(`products/${encodeURIComponent(slug)}/reviews/eligibility/`, {
      skipUnauthorizedEvent: true,
    }),
  submitReview: (slug: string, body: ReviewInput) =>
    api.post<OwnReview>(`products/${encodeURIComponent(slug)}/reviews/`, body),
  favorites: (branch: string | undefined) =>
    api.get<Paginated<ProductSummary>>('favorites/', {
      query: { page_size: 100, ...(branch ? { branch } : {}) },
    }),
  reconfigureCartItem: (
    id: number,
    body: { quantity: number; option_ids: number[]; note: string },
  ) => api.patch<Cart>(`cart/items/${id}/`, body),
};

// ── Query keys (all under ['products', …]) ──
export const catalogKeys = {
  facets: (params: CatalogParams) => [...qk.products.all, 'facets', params] as const,
  detail: (slug: string, branch: string | undefined) =>
    [...qk.products.detail(slug), branch ?? null] as const,
  quote: (slug: string, req: QuoteRequest) => [...qk.products.all, 'quote', slug, req] as const,
  reviews: (slug: string) => [...qk.products.all, 'reviews', slug] as const,
  eligibility: (slug: string, userId: number | null) =>
    [...qk.products.all, 'review-eligibility', slug, userId] as const,
  resolved: (ids: readonly number[], branch: string | undefined) =>
    [...qk.products.all, 'resolved', [...ids].sort((a, b) => a - b), branch ?? null] as const,
};

// ── Hooks ──
export function useCatalogProducts(params: CatalogParams, enabled = true) {
  return useQuery({
    queryKey: qk.products.list(params as ProductListParams),
    queryFn: ({ signal }) => catalogExtras.products(params, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

/** Facet counts for the filter UI. `ordering`, `page` and `page_size` do not affect them. */
export function useFacets(params: CatalogParams, enabled = true) {
  const { ordering: _ordering, page: _page, page_size: _size, branch: _branch, ...rest } = params;
  void [_ordering, _page, _size, _branch];
  return useQuery({
    queryKey: catalogKeys.facets(rest),
    queryFn: ({ signal }) => catalogExtras.facets(rest, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

export function useProductDetail(
  slug: string | undefined,
  branch: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: catalogKeys.detail(slug ?? '', branch),
    queryFn: ({ signal }) => catalogExtras.detail(slug as string, branch, signal),
    enabled: Boolean(slug) && enabled,
    staleTime: 30_000,
  });
}

/** Server-computed price for a configuration. The caller debounces `request`; the previous quote stays visible while refetching. */
export function useQuote(slug: string, request: QuoteRequest, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.quote(slug, request),
    queryFn: ({ signal }) => catalogExtras.quote(slug, request, signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
}

export function useReviews(slug: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: catalogKeys.reviews(slug),
    queryFn: ({ pageParam }) => catalogExtras.reviews(slug, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    enabled,
    staleTime: 60_000,
  });
}

export function useReviewEligibility(slug: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: catalogKeys.eligibility(slug, user?.id ?? null),
    queryFn: () => catalogExtras.eligibility(slug),
    enabled,
    staleTime: 30_000,
  });
}

export function useSubmitReview(slug: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (body: ReviewInput) => catalogExtras.submitReview(slug, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: catalogKeys.eligibility(slug, user?.id ?? null) });
    },
  });
}

/**
 * Resolve product cards for a set of ids (anonymous favourites live as bare ids in localStorage). One request
 * (`products/?ids=…`); inactive products simply do not come back.
 */
export function useProductsByIds(
  ids: readonly number[],
  branch: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: catalogKeys.resolved(ids, branch),
    queryFn: async ({ signal }) => {
      const page = await catalogExtras.products(
        { ids: ids.slice(0, 100).join(','), page_size: 100, ...(branch ? { branch } : {}) },
        signal,
      );
      return page.results;
    },
    enabled: enabled && ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Signed-in favourites as full cards (newest first). */
export function useFavoriteProducts(branch: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.favorites.list, branch ?? null],
    queryFn: async () => (await catalogExtras.favorites(branch)).results,
    enabled,
    staleTime: 15_000,
  });
}

/** Change the options/quantity/note of an existing cart line (`PATCH cart/items/{id}/`). */
export function useReconfigureCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      quantity: number;
      option_ids: number[];
      note: string;
    }) => catalogExtras.reconfigureCartItem(id, body),
    onSuccess: (cart) => {
      qc.setQueryData(qk.cart, cart);
      void qc.invalidateQueries({ queryKey: qk.cart });
    },
  });
}
