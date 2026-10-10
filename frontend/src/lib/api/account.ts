import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import type { MeResponse, User } from './types';
import { unwrapList } from './util';

export interface Address {
  id: number;
  label?: string;
  recipient_name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  postal_code?: string;
  zone?: number | null;
  zone_name: string;
  instructions?: string;
  is_default?: boolean;
}

export type AddressInput = Omit<Address, 'id' | 'zone_name'>;

export interface ProfileUpdate {
  first_name?: string;
  last_name?: string;
  phone?: string;
  marketing_opt_in?: boolean;
  email?: string;
  current_password?: string;
}

export interface VerifyResult {
  detail: string;
  email_verified: boolean;
}

export const accountApi = {
  verifyEmail: (token: string) =>
    api.post<VerifyResult>('auth/verify-email/', { token }, { skipUnauthorizedEvent: true }),
  resendVerification: () => api.post<VerifyResult>('auth/resend-verification/'),
  update: (patch: ProfileUpdate) => api.patch<User>('account/', patch),
  changePassword: (body: { current_password: string; new_password: string }) =>
    api.post<{ detail?: string } | undefined>('account/password/', body),
  addresses: async () => unwrapList(await api.get<Address[]>('addresses/')),
  createAddress: (body: Partial<AddressInput>) => api.post<Address>('addresses/', body),
  updateAddress: (id: number, body: Partial<AddressInput>) =>
    api.patch<Address>(`addresses/${id}/`, body),
  deleteAddress: (id: number) => api.delete(`addresses/${id}/`),
  setDefaultAddress: (id: number) => api.post<Address>(`addresses/${id}/set-default/`),
};

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: accountApi.update,
    onSuccess: (user) => {
      // Keep the cached identity (header, checkout prefill) in step with the saved profile.
      qc.setQueryData<MeResponse>(qk.auth.me, (me) => (me ? { ...me, user } : me));
    },
  });
}

export const useChangePassword = () => useMutation({ mutationFn: accountApi.changePassword });

export const useAddresses = (enabled = true) =>
  useQuery({ queryKey: qk.addresses, queryFn: accountApi.addresses, enabled });

function useAddressMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.addresses }),
  });
}

export const useCreateAddress = () => useAddressMutation(accountApi.createAddress);
export const useUpdateAddress = () =>
  useAddressMutation(({ id, body }: { id: number; body: Partial<AddressInput> }) =>
    accountApi.updateAddress(id, body),
  );
export const useDeleteAddress = () => useAddressMutation(accountApi.deleteAddress);
export const useSetDefaultAddress = () => useAddressMutation(accountApi.setDefaultAddress);

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: accountApi.verifyEmail,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.auth.me }),
  });
}

export const useResendVerification = () =>
  useMutation({ mutationFn: accountApi.resendVerification });
