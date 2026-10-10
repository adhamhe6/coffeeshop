import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { ak, type ListParams } from './peopleKeys';
import type {
  AdminCustomerDetail,
  AdminCustomerRow,
  AdminStaffMember,
  BranchOption,
  RoleMatrix,
  StaffCreatePayload,
  StaffUpdatePayload,
} from './peopleTypes';
import type { Paginated } from './types';

export const PAGE_SIZE = 20;

/** Drops empty filters so they never reach the URL. */
export function cleanParams(p: ListParams): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== null),
  ) as Record<string, string | number | boolean>;
}

// ── customers ───────────────────────────────────────────────────────────
export const adminCustomersApi = {
  list: (p: ListParams) =>
    api.get<Paginated<AdminCustomerRow>>('admin/customers/', { query: cleanParams(p) }),
  detail: (id: number | string) => api.get<AdminCustomerDetail>(`admin/customers/${id}/`),
  suspend: (id: number, reason: string) =>
    api.post<AdminCustomerDetail>(`admin/customers/${id}/suspend/`, { reason }),
  restore: (id: number) => api.post<AdminCustomerDetail>(`admin/customers/${id}/restore/`),
};

export const useAdminCustomers = (params: ListParams) =>
  useQuery({
    queryKey: ak.customers.list(params),
    queryFn: () => adminCustomersApi.list(params),
    placeholderData: keepPreviousData,
  });

export const useAdminCustomer = (id: string | undefined) =>
  useQuery({
    queryKey: ak.customers.detail(id ?? ''),
    queryFn: () => adminCustomersApi.detail(id as string),
    enabled: Boolean(id),
  });

export function useSuspendCustomer(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => adminCustomersApi.suspend(id, reason),
    onSuccess: (data) => {
      qc.setQueryData(ak.customers.detail(id), data);
      void qc.invalidateQueries({ queryKey: ak.customers.all });
    },
  });
}

export function useRestoreCustomer(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminCustomersApi.restore(id),
    onSuccess: (data) => {
      qc.setQueryData(ak.customers.detail(id), data);
      void qc.invalidateQueries({ queryKey: ak.customers.all });
    },
  });
}

// ── staff ───────────────────────────────────────────────────────────────
export const adminStaffApi = {
  list: (p: ListParams) =>
    api.get<Paginated<AdminStaffMember>>('admin/staff/', { query: cleanParams(p) }),
  roles: () => api.get<RoleMatrix>('admin/staff/roles/'),
  create: (payload: StaffCreatePayload) => api.post<AdminStaffMember>('admin/staff/', payload),
  update: (id: number, payload: StaffUpdatePayload) =>
    api.patch<AdminStaffMember>(`admin/staff/${id}/`, payload),
  setActive: (id: number, active: boolean) =>
    api.post<AdminStaffMember>(`admin/staff/${id}/${active ? 'activate' : 'deactivate'}/`),
  branchOptions: () => api.get<BranchOption[]>('admin/branches/options/'),
};

export const useAdminStaff = (params: ListParams) =>
  useQuery({
    queryKey: ak.staff.list(params),
    queryFn: () => adminStaffApi.list(params),
    placeholderData: keepPreviousData,
  });

export const useRoleMatrix = () =>
  useQuery({ queryKey: ak.staff.roles, queryFn: adminStaffApi.roles, staleTime: 10 * 60_000 });

export const useBranchOptions = () =>
  useQuery({
    queryKey: ak.branchOptions,
    queryFn: adminStaffApi.branchOptions,
    staleTime: 5 * 60_000,
  });

export function useSaveStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; create?: StaffCreatePayload; update?: StaffUpdatePayload }) =>
      v.id !== undefined
        ? adminStaffApi.update(v.id, v.update ?? {})
        : adminStaffApi.create(v.create as StaffCreatePayload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.staff.all }),
  });
}

export function useSetStaffActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; active: boolean }) => adminStaffApi.setActive(v.id, v.active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.staff.all }),
  });
}
