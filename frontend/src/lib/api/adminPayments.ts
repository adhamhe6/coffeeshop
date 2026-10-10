import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { components } from './schema';
import { adminOrderKeys } from './adminOrders';
import type { Paginated } from './types';

type S = components['schemas'];
export type AdminPayment = S['AdminPayment'];
export type AdminPaymentDetail = S['AdminPaymentDetail'];
export type AdminRefund = S['AdminRefund'];
export type AdminPaymentEvent = S['AdminPaymentEvent'];

export interface AdminPaymentListParams {
  q?: string;
  status?: string[];
  provider?: string;
  is_sandbox?: boolean;
  branch?: number | string;
  date_from?: string;
  date_to?: string;
  failed?: boolean;
  needs_refund?: boolean;
  flagged?: boolean;
  ordering?: string;
  page?: number;
}

export const adminPaymentKeys = {
  all: ['admin', 'payments'] as const,
  list: (p: AdminPaymentListParams) => ['admin', 'payments', 'list', p] as const,
  detail: (id: number) => ['admin', 'payments', 'detail', id] as const,
};

/** Result of `POST admin/payments/{id}/refund/`. A FAILED refund is a 502 `refund_failed` error carrying `extra.refund`. */
export interface RefundResult {
  refund: AdminRefund;
  payment: AdminPaymentDetail;
}

export const adminPaymentsApi = {
  list: (p: AdminPaymentListParams) =>
    api.get<Paginated<AdminPayment>>('admin/payments/', {
      query: {
        q: p.q,
        status: p.status,
        provider: p.provider,
        is_sandbox: p.is_sandbox === undefined ? undefined : String(p.is_sandbox),
        branch: p.branch,
        date_from: p.date_from,
        date_to: p.date_to,
        failed: p.failed ? 'true' : undefined,
        needs_refund: p.needs_refund ? 'true' : undefined,
        flagged: p.flagged ? 'true' : undefined,
        ordering: p.ordering,
        page: p.page,
      },
    }),
  detail: (id: number) => api.get<AdminPaymentDetail>(`admin/payments/${id}/`),
  refund: (id: number, body: { amount?: string; reason: string }, idempotencyKey: string) =>
    api.post<RefundResult>(`admin/payments/${id}/refund/`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};

export function useAdminPayments(params: AdminPaymentListParams) {
  return useQuery({
    queryKey: adminPaymentKeys.list(params),
    queryFn: () => adminPaymentsApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useAdminPayment(id: number | null) {
  return useQuery({
    queryKey: adminPaymentKeys.detail(id ?? 0),
    queryFn: () => adminPaymentsApi.detail(id as number),
    enabled: id !== null,
    staleTime: 5_000,
    // A pending refund is settled by the provider later: keep looking while one is open.
    refetchInterval: (q) =>
      q.state.data?.refunds.some((r) => r.status === 'PENDING') ? 10_000 : false,
  });
}

export function useRefundPayment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { amount?: string; reason: string; idempotencyKey: string }) =>
      adminPaymentsApi.refund(id, { amount: v.amount, reason: v.reason }, v.idempotencyKey),
    onSettled: () => {
      // A refund changes the payment, the order's payment status and the dashboard numbers.
      void qc.invalidateQueries({ queryKey: adminPaymentKeys.all });
      void qc.invalidateQueries({ queryKey: adminOrderKeys.all });
      void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
    },
  });
}
