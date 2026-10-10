import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, requestBlob } from './client';
import { ak, type ListParams } from './peopleKeys';
import { cleanParams } from './adminPeople';
import { qk } from './keys';
import type {
  AdminAnnouncement,
  AdminAnnouncementPayload,
  AdminBlock,
  AdminCategoryRef,
  AdminCoupon,
  AdminNewsletterSubscriber,
  AdminPage,
  AdminPagePayload,
  AdminProductRef,
  AdminSocial,
  AdminSocialPayload,
  CouponPayload,
} from './peopleTypes';
import type { Paginated } from './types';

// ── coupons ─────────────────────────────────────────────────────────────
export const adminCouponsApi = {
  list: (p: ListParams) =>
    api.get<Paginated<AdminCoupon>>('admin/coupons/', { query: cleanParams(p) }),
  detail: (id: number | string) => api.get<AdminCoupon>(`admin/coupons/${id}/`),
  create: (payload: CouponPayload) => api.post<AdminCoupon>('admin/coupons/', payload),
  update: (id: number, payload: Partial<CouponPayload>) =>
    api.patch<AdminCoupon>(`admin/coupons/${id}/`, payload),
  remove: (id: number) => api.delete(`admin/coupons/${id}/`),
};

export const useAdminCoupons = (params: ListParams) =>
  useQuery({
    queryKey: ak.coupons.list(params),
    queryFn: () => adminCouponsApi.list(params),
    placeholderData: keepPreviousData,
  });

export const useAdminCoupon = (id: string | undefined) =>
  useQuery({
    queryKey: ak.coupons.detail(id ?? ''),
    queryFn: () => adminCouponsApi.detail(id as string),
    enabled: Boolean(id),
  });

export function useSaveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; payload: CouponPayload }) =>
      v.id !== undefined
        ? adminCouponsApi.update(v.id, v.payload)
        : adminCouponsApi.create(v.payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.coupons.all }),
  });
}

export function useToggleCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; is_active: boolean }) =>
      adminCouponsApi.update(v.id, { is_active: v.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.coupons.all }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminCouponsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.coupons.all }),
  });
}

/** Category + product pickers for "applies to" (catalogue read endpoints; marketing has `catalog.view`). */
export const useCouponCategories = () =>
  useQuery({
    queryKey: ak.pickers.categories,
    queryFn: async () =>
      (
        await api.get<Paginated<AdminCategoryRef>>('admin/categories/', {
          query: { page_size: 100, ordering: 'name' },
        })
      ).results,
    staleTime: 5 * 60_000,
  });

export const useCouponProductSearch = (q: string) =>
  useQuery({
    queryKey: ak.pickers.products(q),
    queryFn: async () =>
      (
        await api.get<Paginated<AdminProductRef>>('admin/products/', {
          query: { q, page_size: 12, ordering: 'name' },
        })
      ).results,
    placeholderData: keepPreviousData,
  });

export const productNameKey = (id: number) => ['admin', 'coupon-pickers', 'product', id] as const;

/** Names for already-chosen product ids (cached; picking from search seeds the cache so nothing refetches). */
export function useProductNames(ids: readonly number[]): Record<number, string> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: productNameKey(id),
      queryFn: () => api.get<{ id: number; name: string }>(`admin/products/${id}/`),
      staleTime: 5 * 60_000,
    })),
  });
  const out: Record<number, string> = {};
  ids.forEach((id, i) => {
    const name = results[i]?.data?.name;
    if (name) out[id] = name;
  });
  return out;
}

// ── content: pages ──────────────────────────────────────────────────────
const bumpPublic = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: qk.content.all });
  void qc.invalidateQueries({ queryKey: qk.store });
};

export const useAdminPages = () =>
  useQuery({
    queryKey: ak.content.pages,
    queryFn: async () =>
      (await api.get<Paginated<AdminPage>>('admin/pages/', { query: { page_size: 100 } })).results,
  });

export function useSavePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; payload: AdminPagePayload }) =>
      v.id !== undefined
        ? api.patch<AdminPage>(`admin/pages/${v.id}/`, v.payload)
        : api.post<AdminPage>('admin/pages/', v.payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ak.content.pages });
      bumpPublic(qc);
    },
  });
}

// ── content: blocks ─────────────────────────────────────────────────────
export const useAdminBlocks = () =>
  useQuery({
    queryKey: ak.content.blocks,
    queryFn: async () =>
      (await api.get<Paginated<AdminBlock>>('admin/blocks/', { query: { page_size: 100 } }))
        .results,
  });

export function useSaveBlock() {
  const qc = useQueryClient();
  return useMutation({
    /** Multipart when an image is attached (or removed), JSON otherwise. */
    mutationFn: (v: {
      key: string;
      exists: boolean;
      fields: Record<string, string | boolean>;
      image?: File | null;
      removeImage?: boolean;
    }) => {
      const useForm = Boolean(v.image) || Boolean(v.removeImage);
      let body: unknown = v.fields;
      if (useForm) {
        const fd = new FormData();
        for (const [k, val] of Object.entries(v.fields)) fd.append(k, String(val));
        if (v.image) fd.append('image', v.image);
        if (v.removeImage && !v.image) fd.append('remove_image', 'true');
        body = fd;
      }
      return v.exists
        ? api.patch<AdminBlock>(`admin/blocks/${encodeURIComponent(v.key)}/`, body)
        : api.post<AdminBlock>('admin/blocks/', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ak.content.blocks });
      bumpPublic(qc);
    },
  });
}

// ── content: announcements ──────────────────────────────────────────────
export const useAdminAnnouncements = () =>
  useQuery({
    queryKey: ak.content.announcements,
    queryFn: async () =>
      (
        await api.get<Paginated<AdminAnnouncement>>('admin/announcements/', {
          query: { page_size: 100 },
        })
      ).results,
  });

export function useSaveAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; payload: Partial<AdminAnnouncementPayload> }) =>
      v.id !== undefined
        ? api.patch<AdminAnnouncement>(`admin/announcements/${v.id}/`, v.payload)
        : api.post<AdminAnnouncement>('admin/announcements/', v.payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ak.content.announcements });
      bumpPublic(qc);
    },
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`admin/announcements/${id}/`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ak.content.announcements });
      bumpPublic(qc);
    },
  });
}

// ── social ──────────────────────────────────────────────────────────────
export const useAdminSocial = () =>
  useQuery({
    queryKey: ak.content.social,
    queryFn: async () =>
      (await api.get<Paginated<AdminSocial>>('admin/social/', { query: { page_size: 100 } }))
        .results,
  });

export function useSaveSocial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; payload: Partial<AdminSocialPayload> }) =>
      v.id !== undefined
        ? api.patch<AdminSocial>(`admin/social/${v.id}/`, v.payload)
        : api.post<AdminSocial>('admin/social/', v.payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ak.content.social });
      bumpPublic(qc);
    },
  });
}

export function useDeleteSocial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`admin/social/${id}/`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ak.content.social });
      bumpPublic(qc);
    },
  });
}

// ── newsletter ──────────────────────────────────────────────────────────
export const useAdminNewsletter = (params: ListParams) =>
  useQuery({
    queryKey: ak.content.newsletter(params),
    queryFn: () =>
      api.get<Paginated<AdminNewsletterSubscriber>>('admin/newsletter/', {
        query: cleanParams(params),
      }),
    placeholderData: keepPreviousData,
  });

export const downloadNewsletterCsv = (params: ListParams) =>
  requestBlob('admin/newsletter/', {
    query: { ...cleanParams(params), page: undefined, format: 'csv' },
  });
