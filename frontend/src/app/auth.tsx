import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLogin, useLogout, useMe, useRegister } from '@/lib/api/auth';
import type { LoginPayload, RegisterPayload, StaffInfo, User } from '@/lib/api/types';

interface AuthValue {
  user: User | null;
  staff: StaffInfo | null;
  /** `loading` only on first load; afterwards the last known identity is kept while refetching. */
  status: 'loading' | 'authenticated' | 'anonymous';
  isLoading: boolean;
  isAuthenticated: boolean;
  isStaff: boolean;
  hasCapability: (capability: string) => boolean;
  hasAnyCapability: (...capabilities: string[]) => boolean;
  login: (payload: LoginPayload) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const { mutateAsync: loginAsync } = useLogin();
  const { mutateAsync: registerAsync } = useRegister();
  const { mutateAsync: logoutAsync } = useLogout();

  const user = me.data?.user ?? null;
  const staff = me.data?.staff ?? null;
  const caps = useMemo(() => new Set(staff?.capabilities ?? []), [staff]);

  const login = useCallback(
    async (p: LoginPayload) => {
      const result = await loginAsync(p);
      return result.user as User;
    },
    [loginAsync],
  );
  const register = useCallback((p: RegisterPayload) => registerAsync(p), [registerAsync]);
  const logout = useCallback(async () => {
    await logoutAsync();
  }, [logoutAsync]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      staff,
      status: me.isPending ? 'loading' : user ? 'authenticated' : 'anonymous',
      isLoading: me.isPending,
      isAuthenticated: Boolean(user),
      isStaff: Boolean(staff),
      hasCapability: (c) => caps.has(c),
      hasAnyCapability: (...list) => list.some((c) => caps.has(c)),
      login,
      register,
      logout,
      refresh: () => qc.invalidateQueries({ queryKey: ['auth', 'me'] }),
    }),
    [user, staff, me.isPending, caps, login, register, logout, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
