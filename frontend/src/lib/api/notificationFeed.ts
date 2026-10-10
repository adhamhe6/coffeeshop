import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import type { MeResponse, Paginated } from './types';

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  is_read: boolean;
  order_number: string | null;
  created_at: string;
}

export const notificationFeedApi = {
  list: (page = 1, unreadOnly = false) =>
    api.get<Paginated<AppNotification>>('notifications/', {
      query: { page, page_size: 15, unread: unreadOnly ? true : undefined },
    }),
  markRead: (id: number) => api.post<AppNotification>(`notifications/${id}/read/`),
  markAllRead: () => api.post<{ updated: number }>('notifications/read-all/'),
};

export const useNotificationFeed = (page = 1, unreadOnly = false, enabled = true) =>
  useQuery({
    queryKey: qk.notifications.list(page, unreadOnly),
    queryFn: () => notificationFeedApi.list(page, unreadOnly),
    enabled,
    placeholderData: keepPreviousData,
  });

/** The unread badge lives on `auth/me/`; keep it in step without waiting for the next poll. */
function setUnread(qc: ReturnType<typeof useQueryClient>, next: (n: number) => number) {
  qc.setQueryData<MeResponse>(qk.auth.me, (me) =>
    me ? { ...me, unread_notifications: Math.max(0, next(me.unread_notifications)) } : me,
  );
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationFeedApi.markRead,
    onSuccess: async () => {
      setUnread(qc, (n) => n - 1);
      await qc.invalidateQueries({ queryKey: [...qk.notifications.all, 'list'] });
      void qc.invalidateQueries({ queryKey: qk.auth.me });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationFeedApi.markAllRead,
    onSuccess: async () => {
      setUnread(qc, () => 0);
      await qc.invalidateQueries({ queryKey: [...qk.notifications.all, 'list'] });
      void qc.invalidateQueries({ queryKey: qk.auth.me });
    },
  });
}
