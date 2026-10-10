import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import { unwrapList } from './util';
import type {
  Category,
  Collection,
  CollectionDetail,
  Paginated,
  ProductDetail,
  ProductListParams,
  ProductSuggestion,
  ProductSummary,
} from './types';

export const catalogApi = {
  categories: async () =>
    unwrapList(await api.get<Category[] | Paginated<Category>>('categories/')),
  products: (params: ProductListParams = {}, signal?: AbortSignal) =>
    api.get<Paginated<ProductSummary>>('products/', {
      query: params as Record<string, string | number | boolean>,
      signal,
    }),
  product: (slug: string) => api.get<ProductDetail>(`products/${encodeURIComponent(slug)}/`),
  suggest: async (q: string, signal?: AbortSignal) =>
    unwrapList(
      await api.get<ProductSuggestion[] | { results: ProductSuggestion[] }>('products/suggest/', {
        query: { q },
        signal,
      }),
    ),
  collections: async () =>
    unwrapList(await api.get<Collection[] | Paginated<Collection>>('collections/')),
  collection: (slug: string) =>
    api.get<CollectionDetail>(`collections/${encodeURIComponent(slug)}/`),
};

const FIVE_MIN = 5 * 60_000;

export const useCategories = () =>
  useQuery({ queryKey: qk.categories.all, queryFn: catalogApi.categories, staleTime: FIVE_MIN });

export const useProducts = (params: ProductListParams = {}, options: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: qk.products.list(params),
    queryFn: ({ signal }) => catalogApi.products(params, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    ...options,
  });

export const useProduct = (slug: string | undefined) =>
  useQuery({
    queryKey: qk.products.detail(slug ?? ''),
    queryFn: () => catalogApi.product(slug as string),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });

/** Autocomplete suggestions. Pass an already-debounced string; queries under 2 chars are disabled. */
export const useProductSuggestions = (q: string) =>
  useQuery({
    queryKey: qk.products.suggest(q),
    queryFn: ({ signal }) => catalogApi.suggest(q, signal),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

export const useCollections = () =>
  useQuery({ queryKey: qk.collections.all, queryFn: catalogApi.collections, staleTime: FIVE_MIN });

export const useCollection = (slug: string | undefined) =>
  useQuery({
    queryKey: qk.collections.detail(slug ?? ''),
    queryFn: () => catalogApi.collection(slug as string),
    enabled: Boolean(slug),
    staleTime: FIVE_MIN,
  });
