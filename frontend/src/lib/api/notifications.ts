import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { authApi } from './auth';
import { qk } from './keys';
import type { NotificationItem, Paginated } from './types';

export const notificationsApi = {
  list: (page = 1) => api.get<Paginated<NotificationItem>>('notifications/', { query: { page } }),
  markRead: (id: number) => api.post<void>(`notifications/${id}/read/`),
  markAllRead: () => api.post<void>('notifications/read-all/'),
};

/**
 * Unread count comes with `auth/me/` (`unread_notifications`), so it shares that query and costs no extra request.
 * While signed in it is refreshed once a minute (paused in background tabs).
 */
export const useUnreadNotifications = (enabled: boolean) =>
  useQuery({
    queryKey: qk.auth.me,
    queryFn: authApi.me,
    select: (me) => me.unread_notifications,
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
