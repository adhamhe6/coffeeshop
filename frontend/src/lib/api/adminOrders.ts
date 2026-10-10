import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type { components } from './schema';
import type { Paginated } from './types';

/** Staff order operations (`/admin/orders/…`). Types come straight from the generated OpenAPI schema. */
type S = components['schemas'];
export type AdminOrderRow = S['AdminOrderRow'];
export type AdminOrderDetail = S['AdminOrderDetail'];
export type AdminQueue = S['AdminQueue'];
export type AdminCancelResponse = S['AdminCancelResponse'];
export type AdminRefundOutcome = S['AdminRefundOutcome'];
export type AdminNote = S['AdminNote'];

export interface AdminOrderListParams {
  q?: string;
  status?: string[];
  payment_status?: string[];
  branch?: number | string;
  order_type?: string;
  payment_method?: string;
  date_from?: string;
  date_to?: string;
  stuck?: boolean;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export const adminOrderKeys = {
  all: ['admin', 'orders'] as const,
  list: (p: AdminOrderListParams) => ['admin', 'orders', 'list', p] as const,
  board: (branch: number | string | undefined, stuck: boolean) =>
    ['admin', 'orders', 'board', branch ?? 'all', stuck] as const,
  queue: (branch?: number | string) => ['admin', 'orders', 'queue', branch ?? 'all'] as const,
  detail: (number: string) => ['admin', 'orders', 'detail', number] as const,
};

/** Statuses that are still being worked on (the board's columns), in workflow order. */
export const ACTIVE_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
] as const;

export const BOARD_REFRESH_MS = 15_000;

export const adminOrdersApi = {
  list: (p: AdminOrderListParams) =>
    api.get<Paginated<AdminOrderRow>>('admin/orders/', {
      query: {
        q: p.q,
        status: p.status,
        payment_status: p.payment_status,
        branch: p.branch,
        order_type: p.order_type,
        payment_method: p.payment_method,
        date_from: p.date_from,
        date_to: p.date_to,
        stuck: p.stuck === undefined ? undefined : String(p.stuck),
        ordering: p.ordering,
        page: p.page,
        page_size: p.page_size,
      },
    }),
  queue: (branch?: number | string) =>
    api.get<AdminQueue>('admin/orders/queue/', { query: { branch } }),
  detail: (number: string) =>
    api.get<AdminOrderDetail>(`admin/orders/${encodeURIComponent(number)}/`),
  transition: (number: string, to_status: string, note = '') =>
    api.post<AdminOrderDetail>(`admin/orders/${encodeURIComponent(number)}/transition/`, {
      to_status,
      note,
    }),
  cancel: (number: string, reason: string, refund: boolean) =>
    api.post<AdminCancelResponse>(`admin/orders/${encodeURIComponent(number)}/cancel/`, {
      reason,
      refund,
    }),
  addNote: (number: string, body: string) =>
    api.post<AdminNote>(`admin/orders/${encodeURIComponent(number)}/notes/`, { body }),
  collectCash: (number: string) =>
    api.post<AdminOrderDetail>(`admin/orders/${encodeURIComponent(number)}/collect-cash/`),
};

export function useAdminOrders(params: AdminOrderListParams) {
  return useQuery({
    queryKey: adminOrderKeys.list(params),
    queryFn: () => adminOrdersApi.list(params),
    placeholderData: keepPreviousData,
  });
}

/** Queue counts (`admin/orders/queue/`), refreshed while the tab is visible. */
export function useAdminQueue(branch?: number | string, refetchMs: number | false = false) {
  return useQuery({
    queryKey: adminOrderKeys.queue(branch),
    queryFn: () => adminOrdersApi.queue(branch),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

/** Every active order for the board (one request; the board is for the live queue, which stays small). */
export function useAdminBoardOrders(
  branch: number | string | undefined,
  stuckOnly: boolean,
  refetchMs: number | false = BOARD_REFRESH_MS,
) {
  return useQuery({
    queryKey: adminOrderKeys.board(branch, stuckOnly),
    queryFn: () =>
      adminOrdersApi.list({
        status: [...ACTIVE_ORDER_STATUSES],
        branch,
        stuck: stuckOnly ? true : undefined,
        ordering: 'placed_at',
        page_size: 100,
      }),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

export function useAdminOrder(number: string | undefined) {
  return useQuery({
    queryKey: adminOrderKeys.detail(number ?? ''),
    queryFn: () => adminOrdersApi.detail(number as string),
    enabled: Boolean(number),
    staleTime: 10_000,
  });
}

/** Queue, list and payment screens all derive from an order: refresh them after any order mutation. */
export function invalidateOrderViews(qc: QueryClient, number?: string) {
  void qc.invalidateQueries({ queryKey: adminOrderKeys.all, refetchType: 'active' });
  if (number) void qc.invalidateQueries({ queryKey: adminOrderKeys.detail(number) });
  void qc.invalidateQueries({ queryKey: ['admin', 'payments'], refetchType: 'active' });
  void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'], refetchType: 'active' });
}

export function useTransitionOrder(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { to: string; note?: string }) =>
      adminOrdersApi.transition(number, v.to, v.note ?? ''),
    onSuccess: (detail) => {
      qc.setQueryData(adminOrderKeys.detail(number), detail);
    },
    onSettled: () => invalidateOrderViews(qc, number),
  });
}

export function useCancelOrder(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { reason: string; refund: boolean }) =>
      adminOrdersApi.cancel(number, v.reason, v.refund),
    onSuccess: (res) => {
      qc.setQueryData(adminOrderKeys.detail(number), res.order);
    },
    onSettled: () => invalidateOrderViews(qc, number),
  });
}

export function useAddOrderNote(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => adminOrdersApi.addNote(number, body),
    onSettled: () => void qc.invalidateQueries({ queryKey: adminOrderKeys.detail(number) }),
  });
}

export function useCollectCash(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminOrdersApi.collectCash(number),
    onSuccess: (detail) => {
      qc.setQueryData(adminOrderKeys.detail(number), detail);
    },
    onSettled: () => invalidateOrderViews(qc, number),
  });
}
