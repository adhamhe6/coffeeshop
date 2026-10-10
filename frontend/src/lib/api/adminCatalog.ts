import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from './client';
import { aqk } from './adminKeys';
import { qk } from './keys';
import type { Paginated, ProductType } from './types';

/**
 * Staff catalogue API: products, categories, modifier groups, collections, tags, reviews.
 * Money is a decimal STRING end to end. Image URLs are root-relative or null.
 */

export type StockMode = 'PREPARED' | 'STOCKED';

export const PRODUCT_TYPES: Array<{ value: ProductType; label: string }> = [
  { value: 'BEVERAGE', label: 'Beverage' },
  { value: 'FOOD', label: 'Food' },
  { value: 'BEANS', label: 'Coffee beans' },
  { value: 'MERCH', label: 'Equipment & merchandise' },
  { value: 'GIFT', label: 'Gift set / bundle' },
];
export const productTypeLabel = (t: string) => PRODUCT_TYPES.find((x) => x.value === t)?.label ?? t;

export interface AdminProductRow {
  id: number;
  slug: string;
  sku: string;
  name: string;
  category: number;
  category_name: string;
  product_type: ProductType;
  stock_mode: StockMode;
  base_price: string;
  image: string | null;
  is_active: boolean;
  is_featured: boolean;
  is_bestseller: boolean;
  is_seasonal: boolean;
  is_new: boolean;
  is_sold_out: boolean;
  sort_order: number;
  stock_total: number | null;
  low_stock: boolean;
  is_demo: boolean;
  updated_at: string;
}

export interface AdminGalleryImage {
  id: number;
  url: string | null;
  alt_text: string;
  sort_order: number;
}

export interface ModifierGroupRef {
  id: number;
  name: string;
  display_name: string;
  is_active: boolean;
}

export interface AdminProduct {
  id: number;
  slug: string;
  sku: string;
  name: string;
  category: number;
  category_name: string;
  product_type: ProductType;
  stock_mode: StockMode;
  short_description: string;
  description: string;
  base_price: string;
  image: string | null;
  gallery: AdminGalleryImage[];
  is_active: boolean;
  is_featured: boolean;
  is_bestseller: boolean;
  is_seasonal: boolean;
  is_new: boolean;
  is_sold_out: boolean;
  prep_minutes: number;
  calories: number | null;
  caffeine_mg: number | null;
  allergens: string[];
  nutrition: Record<string, string | number>;
  tags: string[];
  modifier_group_ids: number[];
  modifier_groups: ModifierGroupRef[];
  sort_order: number;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

/** Body for create (POST) and update (PATCH, any subset). */
export type AdminProductInput = Partial<
  Omit<
    AdminProduct,
    | 'id'
    | 'category_name'
    | 'image'
    | 'gallery'
    | 'modifier_groups'
    | 'is_demo'
    | 'created_at'
    | 'updated_at'
  >
>;

export interface AdminProductListParams {
  page?: number;
  page_size?: number;
  q?: string;
  category?: number | string;
  active?: boolean;
  type?: ProductType | string;
  stock_mode?: StockMode | string;
  is_featured?: boolean;
  is_sold_out?: boolean;
  low_stock?: boolean;
  ordering?: string;
}

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  sort_order: number;
  is_active: boolean;
  is_featured: boolean;
  product_count: number;
  active_product_count: number;
}
export type AdminCategoryInput = Partial<
  Pick<AdminCategory, 'name' | 'slug' | 'description' | 'is_active' | 'is_featured'>
>;

export type SelectionType = 'SINGLE' | 'MULTIPLE';
export interface AdminModifierOption {
  id: number;
  name: string;
  price_delta: string;
  is_default: boolean;
  is_active: boolean;
  is_available: boolean;
  sort_order: number;
}
export type AdminModifierOptionInput = Partial<
  Pick<
    AdminModifierOption,
    'name' | 'price_delta' | 'is_default' | 'is_active' | 'is_available' | 'sort_order'
  >
>;
export interface AdminModifierGroup {
  id: number;
  name: string;
  display_name: string;
  selection_type: SelectionType;
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  options: AdminModifierOption[];
}
export type AdminModifierGroupInput = Partial<
  Pick<
    AdminModifierGroup,
    | 'name'
    | 'display_name'
    | 'selection_type'
    | 'is_required'
    | 'min_select'
    | 'max_select'
    | 'is_active'
  >
> & { options?: AdminModifierOptionInput[] };

export interface AdminCollectionProduct {
  id: number;
  name: string;
  slug: string;
  image: string | null;
  is_active: boolean;
  base_price: string;
}
export interface AdminCollection {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  product_count: number;
  product_ids: number[];
  products: AdminCollectionProduct[];
}
export type AdminCollectionInput = Partial<
  Pick<AdminCollection, 'name' | 'slug' | 'description' | 'is_active' | 'is_featured'>
> & { product_ids?: number[] };

export interface AdminTag {
  id: number;
  name: string;
  slug: string;
  product_count: number;
}

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface AdminReview {
  id: number;
  product: { id: number; name: string; slug: string };
  customer: { id: number; name: string; email: string };
  order_number: string | null;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  is_demo: boolean;
  moderated_by: string | null;
  moderated_at: string | null;
  created_at: string;
}
export interface AdminReviewListParams {
  page?: number;
  page_size?: number;
  status?: ReviewStatus | string;
  rating?: number | string;
  is_demo?: boolean;
  q?: string;
  product?: number | string;
  ordering?: string;
}

const ALL = { page_size: 100 } as const;

export const adminCatalogApi = {
  // products
  products: (params: AdminProductListParams = {}, signal?: AbortSignal) =>
    api.get<Paginated<AdminProductRow>>('admin/products/', {
      query: params as Record<string, string | number | boolean | undefined>,
      signal,
    }),
  product: (id: number | string) => api.get<AdminProduct>(`admin/products/${id}/`),
  createProduct: (body: AdminProductInput) => api.post<AdminProduct>('admin/products/', body),
  updateProduct: (id: number, body: AdminProductInput) =>
    api.patch<AdminProduct>(`admin/products/${id}/`, body),
  deleteProduct: (id: number) => api.delete(`admin/products/${id}/`),
  archiveProduct: (id: number) => api.post<AdminProduct>(`admin/products/${id}/archive/`),
  unarchiveProduct: (id: number) => api.post<AdminProduct>(`admin/products/${id}/unarchive/`),
  uploadProductImage: (id: number, file: File) => {
    const body = new FormData();
    body.append('image', file);
    return api.post<{ image: string | null }>(`admin/products/${id}/image/`, body);
  },
  removeProductImage: (id: number) =>
    api.delete<{ image: string | null }>(`admin/products/${id}/image/`),
  addGalleryImage: (id: number, file: File, altText = '') => {
    const body = new FormData();
    body.append('image', file);
    if (altText) body.append('alt_text', altText);
    return api.post<AdminGalleryImage>(`admin/products/${id}/gallery/`, body);
  },
  updateGalleryImage: (id: number, imageId: number, altText: string) =>
    api.patch<AdminGalleryImage>(`admin/products/${id}/gallery/${imageId}/`, { alt_text: altText }),
  deleteGalleryImage: (id: number, imageId: number) =>
    api.delete(`admin/products/${id}/gallery/${imageId}/`),
  reorderGallery: (id: number, ids: number[]) =>
    api.post<AdminGalleryImage[]>(`admin/products/${id}/gallery/reorder/`, { ids }),

  // categories
  categories: async () =>
    (await api.get<Paginated<AdminCategory>>('admin/categories/', { query: ALL })).results,
  createCategory: (body: AdminCategoryInput) => api.post<AdminCategory>('admin/categories/', body),
  updateCategory: (id: number, body: AdminCategoryInput) =>
    api.patch<AdminCategory>(`admin/categories/${id}/`, body),
  deleteCategory: (id: number) => api.delete(`admin/categories/${id}/`),
  reorderCategories: (ids: number[]) =>
    api.post<AdminCategory[]>('admin/categories/reorder/', { ids }),
  uploadCategoryImage: (id: number, file: File) => {
    const body = new FormData();
    body.append('image', file);
    return api.post<{ image: string | null }>(`admin/categories/${id}/image/`, body);
  },
  removeCategoryImage: (id: number) =>
    api.delete<{ image: string | null }>(`admin/categories/${id}/image/`),

  // modifier groups
  groups: async () =>
    (await api.get<Paginated<AdminModifierGroup>>('admin/modifier-groups/', { query: ALL }))
      .results,
  createGroup: (body: AdminModifierGroupInput) =>
    api.post<AdminModifierGroup>('admin/modifier-groups/', body),
  updateGroup: (id: number, body: AdminModifierGroupInput) =>
    api.patch<AdminModifierGroup>(`admin/modifier-groups/${id}/`, body),
  deleteGroup: (id: number) => api.delete(`admin/modifier-groups/${id}/`),
  createOption: (groupId: number, body: AdminModifierOptionInput) =>
    api.post<AdminModifierOption>(`admin/modifier-groups/${groupId}/options/`, body),
  updateOption: (groupId: number, optionId: number, body: AdminModifierOptionInput) =>
    api.patch<AdminModifierOption>(`admin/modifier-groups/${groupId}/options/${optionId}/`, body),
  deleteOption: (groupId: number, optionId: number) =>
    api.delete(`admin/modifier-groups/${groupId}/options/${optionId}/`),
  reorderOptions: (groupId: number, ids: number[]) =>
    api.post<AdminModifierOption[]>(`admin/modifier-groups/${groupId}/options/reorder/`, { ids }),

  // collections
  collections: async () =>
    (await api.get<Paginated<AdminCollection>>('admin/collections/', { query: ALL })).results,
  createCollection: (body: AdminCollectionInput) =>
    api.post<AdminCollection>('admin/collections/', body),
  updateCollection: (id: number, body: AdminCollectionInput) =>
    api.patch<AdminCollection>(`admin/collections/${id}/`, body),
  deleteCollection: (id: number) => api.delete(`admin/collections/${id}/`),
  reorderCollections: (ids: number[]) =>
    api.post<AdminCollection[]>('admin/collections/reorder/', { ids }),
  replaceCollectionProducts: (id: number, productIds: number[]) =>
    api.put<AdminCollection>(`admin/collections/${id}/products/`, { product_ids: productIds }),
  addCollectionProduct: (id: number, productId: number) =>
    api.post<AdminCollection>(`admin/collections/${id}/products/`, { product_id: productId }),
  removeCollectionProduct: (id: number, productId: number) =>
    api.delete<AdminCollection>(`admin/collections/${id}/products/${productId}/`),
  uploadCollectionImage: (id: number, file: File) => {
    const body = new FormData();
    body.append('image', file);
    return api.post<{ image: string | null }>(`admin/collections/${id}/image/`, body);
  },
  removeCollectionImage: (id: number) =>
    api.delete<{ image: string | null }>(`admin/collections/${id}/image/`),

  tags: async () => (await api.get<Paginated<AdminTag>>('admin/tags/', { query: ALL })).results,

  // reviews
  reviews: (params: AdminReviewListParams = {}, signal?: AbortSignal) =>
    api.get<Paginated<AdminReview>>('admin/reviews/', {
      query: params as Record<string, string | number | boolean | undefined>,
      signal,
    }),
  approveReview: (id: number) => api.post<AdminReview>(`admin/reviews/${id}/approve/`),
  rejectReview: (id: number) => api.post<AdminReview>(`admin/reviews/${id}/reject/`),
};

// ── queries ──────────────────────────────────────────────────────────────
export const useAdminProducts = (params: AdminProductListParams) =>
  useQuery({
    queryKey: aqk.products.list(params as Record<string, string | number | boolean | undefined>),
    queryFn: ({ signal }) => adminCatalogApi.products(params, signal),
    placeholderData: keepPreviousData,
  });

export const useAdminProduct = (id: number | string | undefined) =>
  useQuery({
    queryKey: aqk.products.detail(id ?? ''),
    queryFn: () => adminCatalogApi.product(id as number | string),
    enabled: id !== undefined && id !== '',
  });

export const useAdminCategories = () =>
  useQuery({ queryKey: aqk.categories.all, queryFn: adminCatalogApi.categories });
export const useAdminGroups = () =>
  useQuery({ queryKey: aqk.groups.all, queryFn: adminCatalogApi.groups });
export const useAdminCollections = () =>
  useQuery({ queryKey: aqk.collections.all, queryFn: adminCatalogApi.collections });
export const useAdminTags = () =>
  useQuery({ queryKey: aqk.tags.all, queryFn: adminCatalogApi.tags, staleTime: 60_000 });

export const useAdminReviews = (params: AdminReviewListParams) =>
  useQuery({
    queryKey: aqk.reviews.list(params as Record<string, string | number | boolean | undefined>),
    queryFn: ({ signal }) => adminCatalogApi.reviews(params, signal),
    placeholderData: keepPreviousData,
  });

/**
 * After any catalogue write: refresh the admin lists AND drop the storefront's cached catalogue so the public site
 * shows the change on the next navigation (the backend bumps its own cache version too).
 */
export function useInvalidateCatalog() {
  const qc = useQueryClient();
  return useCallback(
    (
      scope: Array<'products' | 'categories' | 'groups' | 'collections' | 'tags'> = ['products'],
    ) => {
      const tasks: Promise<unknown>[] = [];
      for (const s of scope) {
        tasks.push(qc.invalidateQueries({ queryKey: aqk[s].all }));
      }
      // Storefront keys: products, categories and collections all embed product data.
      tasks.push(qc.invalidateQueries({ queryKey: qk.products.all }));
      tasks.push(qc.invalidateQueries({ queryKey: qk.categories.all }));
      tasks.push(qc.invalidateQueries({ queryKey: qk.collections.all }));
      return Promise.all(tasks);
    },
    [qc],
  );
}
