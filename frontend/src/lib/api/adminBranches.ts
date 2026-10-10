import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { aqk } from './adminKeys';
import type { Paginated } from './types';

/** Staff branch API (branches.view / branches.manage; branch managers see only their own branch). */

export interface BranchOption {
  id: number;
  code: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export interface AdminBranch {
  id: number;
  code: string;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  address_line: string;
  city: string;
  postal_code: string;
  latitude: string | null;
  longitude: string | null;
  phone: string;
  email: string;
  timezone: string;
  is_active: boolean;
  is_placeholder_address: boolean;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  accepting_orders: boolean;
  prep_minutes: number;
  sort_order: number;
  is_open_now: boolean;
  created_at: string;
  updated_at: string;
}
export type AdminBranchInput = Partial<
  Omit<AdminBranch, 'id' | 'image' | 'is_open_now' | 'created_at' | 'updated_at'>
>;

/** weekday 0 = Monday … 6 = Sunday; times "HH:MM:SS" (the API also accepts "HH:MM"). */
export interface HoursEntry {
  weekday: number;
  is_closed: boolean;
  opens: string | null;
  closes: string | null;
}
export interface Closure {
  id: number;
  start_date: string;
  end_date: string;
  reason: string;
}
export interface ZoneLink {
  id: number;
  zone: number;
  zone_name: string;
  zone_is_active: boolean;
  fee: string;
  min_order_total: string;
  free_delivery_over: string | null;
  eta_minutes: number;
  is_active: boolean;
}
export type ZoneLinkInput = Partial<
  Pick<ZoneLink, 'fee' | 'min_order_total' | 'free_delivery_over' | 'eta_minutes' | 'is_active'>
> & { zone?: number };

export interface DeliveryZone {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  branch_count: number;
}
export interface BranchStaffMember {
  id: number;
  email: string;
  name: string;
  role: string;
  job_title: string;
}

export const adminBranchesApi = {
  options: () => api.get<BranchOption[]>('admin/branches/options/'),
  list: async () =>
    (await api.get<Paginated<AdminBranch>>('admin/branches/', { query: { page_size: 100 } }))
      .results,
  create: (body: AdminBranchInput) => api.post<AdminBranch>('admin/branches/', body),
  update: (id: number, body: AdminBranchInput) =>
    api.patch<AdminBranch>(`admin/branches/${id}/`, body),
  remove: (id: number) => api.delete(`admin/branches/${id}/`),
  uploadImage: (id: number, file: File) => {
    const body = new FormData();
    body.append('image', file);
    return api.post<{ image: string | null }>(`admin/branches/${id}/image/`, body);
  },
  removeImage: (id: number) => api.delete<{ image: string | null }>(`admin/branches/${id}/image/`),
  hours: (id: number) => api.get<HoursEntry[]>(`admin/branches/${id}/hours/`),
  saveHours: (id: number, hours: HoursEntry[]) =>
    api.put<HoursEntry[]>(`admin/branches/${id}/hours/`, { hours }),
  closures: (id: number) => api.get<Closure[]>(`admin/branches/${id}/closures/`),
  addClosure: (id: number, body: Omit<Closure, 'id'>) =>
    api.post<Closure>(`admin/branches/${id}/closures/`, body),
  removeClosure: (id: number, closureId: number) =>
    api.delete(`admin/branches/${id}/closures/${closureId}/`),
  zones: (id: number) => api.get<ZoneLink[]>(`admin/branches/${id}/zones/`),
  addZone: (id: number, body: ZoneLinkInput) =>
    api.post<ZoneLink>(`admin/branches/${id}/zones/`, body),
  updateZone: (id: number, linkId: number, body: ZoneLinkInput) =>
    api.patch<ZoneLink>(`admin/branches/${id}/zones/${linkId}/`, body),
  removeZone: (id: number, linkId: number) => api.delete(`admin/branches/${id}/zones/${linkId}/`),
  staff: (id: number) => api.get<BranchStaffMember[]>(`admin/branches/${id}/staff/`),
  deliveryZones: async () =>
    (await api.get<Paginated<DeliveryZone>>('admin/delivery-zones/', { query: { page_size: 100 } }))
      .results,
  createDeliveryZone: (body: { name: string; slug?: string; is_active?: boolean }) =>
    api.post<DeliveryZone>('admin/delivery-zones/', body),
  updateDeliveryZone: (
    id: number,
    body: Partial<{ name: string; slug: string; is_active: boolean }>,
  ) => api.patch<DeliveryZone>(`admin/delivery-zones/${id}/`, body),
  deleteDeliveryZone: (id: number) => api.delete(`admin/delivery-zones/${id}/`),
};

/** Branches the signed-in staff member may operate on (works for every staff role). */
export const useBranchOptions = () =>
  useQuery({
    queryKey: aqk.branches.options,
    queryFn: adminBranchesApi.options,
    staleTime: 60_000,
  });
