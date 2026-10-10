import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { ak, type ListParams } from './peopleKeys';
import { cleanParams } from './adminPeople';
import { qk } from './keys';
import type {
  AdminStoreSettings,
  AuditLogEntry,
  PaymentMethodInfo,
  StoreSettingsPatch,
} from './peopleTypes';
import type { Paginated } from './types';

export const useAdminSettings = () =>
  useQuery({
    queryKey: ak.settings,
    queryFn: () => api.get<AdminStoreSettings>('admin/settings/'),
  });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    /** A logo change is its own multipart request (files cannot ride along with JSON lists); the rest is JSON. */
    mutationFn: async (v: {
      patch: StoreSettingsPatch;
      logo?: File | null;
      removeLogo?: boolean;
    }) => {
      let result: AdminStoreSettings | undefined;
      if (v.logo || v.removeLogo) {
        const fd = new FormData();
        if (v.logo) fd.append('logo', v.logo);
        else fd.append('remove_logo', 'true');
        result = await api.patch<AdminStoreSettings>('admin/settings/', fd);
      }
      if (Object.keys(v.patch).length > 0 || !result) {
        result = await api.patch<AdminStoreSettings>('admin/settings/', v.patch);
      }
      return result;
    },
    onSuccess: (data) => {
      qc.setQueryData(ak.settings, data);
      void qc.invalidateQueries({ queryKey: qk.store });
    },
  });
}

/** Public list of payment methods enabled in this deployment (`is_sandbox` flags the simulator). */
export const usePaymentMethods = () =>
  useQuery({
    queryKey: ak.paymentMethods,
    queryFn: () => api.get<PaymentMethodInfo[]>('payments/methods/'),
    staleTime: 60_000,
  });

export const useAuditLogs = (params: ListParams) =>
  useQuery({
    queryKey: ak.audit.list(params),
    queryFn: () =>
      api.get<Paginated<AuditLogEntry>>('admin/audit-logs/', { query: cleanParams(params) }),
    placeholderData: keepPreviousData,
  });
