import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ensureCsrfToken } from './client';
import { isApiError } from './errors';
import { favoritesApi } from './favorites';
import { qk, userScopedKeys } from './keys';
import type { LoginPayload, MeResponse, RegisterPayload, User } from './types';
import { clearLocalFavorites, readLocalFavorites } from '../favoritesStorage';

export interface ConfirmResetPayload {
  uid: string;
  token: string;
  new_password: string;
}

export const ANONYMOUS: MeResponse = {
  authenticated: false,
  user: null,
  staff: null,
  unread_notifications: 0,
};

export const authApi = {
  csrf: () => ensureCsrfToken(),
  /** Anonymous visitors get a 200 with `authenticated: false`; a 401/403 is treated the same. */
  me: async (): Promise<MeResponse> => {
    try {
      const data = await api.get<MeResponse | null>('auth/me/', { skipUnauthorizedEvent: true });
      return data && data.authenticated && data.user ? data : ANONYMOUS;
    } catch (e) {
      if (isApiError(e) && (e.status === 401 || e.status === 403)) return ANONYMOUS;
      throw e;
    }
  },
  login: (payload: LoginPayload) =>
    api.post<MeResponse>('auth/login/', payload, { skipUnauthorizedEvent: true }),
  /** Registration signs the user in (201 + session cookie) but only returns the user; re-read `me` afterwards. */
  register: (payload: RegisterPayload) =>
    api.post<User>('auth/register/', payload, { skipUnauthorizedEvent: true }),
  logout: () => api.post<void>('auth/logout/', undefined, { skipUnauthorizedEvent: true }),
  requestPasswordReset: (email: string) =>
    api.post<{ detail?: string }>(
      'auth/password-reset/',
      { email },
      { skipUnauthorizedEvent: true },
    ),
  confirmPasswordReset: (payload: ConfirmResetPayload) =>
    api.post<{ detail?: string }>('auth/password-reset/confirm/', payload, {
      skipUnauthorizedEvent: true,
    }),
};

export const useMe = () =>
  useQuery({
    queryKey: qk.auth.me,
    queryFn: authApi.me,
    staleTime: 5 * 60_000,
    retry: false,
  });

/**
 * Runs right after a successful login/registration:
 *  1. caches the identity (login returns `me`; registration returns the user, so `me` is re-read),
 *  2. pushes anonymous favourites to the account (best effort — never blocks sign-in),
 *  3. refreshes server state the guest cart merge / account may have changed.
 */
export async function afterSignIn(qc: QueryClient, me?: MeResponse): Promise<void> {
  if (me) qc.setQueryData(qk.auth.me, me);
  else await qc.fetchQuery({ queryKey: qk.auth.me, queryFn: authApi.me, staleTime: 0 });
  const local = readLocalFavorites();
  if (local.length) {
    try {
      const merged = await favoritesApi.merge(local);
      clearLocalFavorites();
      qc.setQueryData(qk.favorites.ids, merged);
    } catch {
      // Keep local favourites; the next sign-in will retry.
    }
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.cart }),
    qc.invalidateQueries({ queryKey: qk.favorites.all }),
    qc.invalidateQueries({ queryKey: qk.notifications.all }),
  ]);
}

/** Drop everything that belongs to the previous identity. */
export function clearSession(qc: QueryClient): void {
  qc.setQueryData(qk.auth.me, ANONYMOUS);
  for (const key of userScopedKeys) qc.removeQueries({ queryKey: key });
  // Staff dashboard data is scoped to the previous staff member's branches: never show it to the next sign-in.
  qc.removeQueries({ queryKey: ['admin'] });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: async (me) => {
      // Django rotates the CSRF token on login; the next unsafe request re-reads the cookie.
      await afterSignIn(qc, me);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: async () => {
      await afterSignIn(qc);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clearSession(qc);
      void qc.invalidateQueries({ queryKey: qk.cart });
    },
  });
}

export const useRequestPasswordReset = () =>
  useMutation({ mutationFn: authApi.requestPasswordReset });
export const useConfirmPasswordReset = () =>
  useMutation({ mutationFn: authApi.confirmPasswordReset });
