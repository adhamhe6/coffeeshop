import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ordersApi, type PaymentSync } from '@/lib/api/orders';
import { qk } from '@/lib/api/keys';

/** Delays (ms) between verification attempts (the last value repeats; growing so a slow provider is not hammered).
 * Exposed as an object so tests can shorten it. */
export const syncTuning = {
  delaysMs: [2_000, 3_000, 5_000, 8_000, 12_000, 20_000],
  maxAttempts: 8,
};

const PENDING = new Set(['PENDING', 'REQUIRES_ACTION']);
export const isPaymentPending = (status: string | undefined) =>
  status === undefined || PENDING.has(status);

/**
 * Asks the backend to verify the payment with the provider (`orders/{n}/payment/sync/`). A browser redirect is
 * never evidence of payment, so this is the only thing that moves the page from "waiting" to "paid".
 * Polls with backoff while the provider still says pending, then gives up honestly after syncTuning.maxAttempts.
 */
export function usePaymentSync(number: string | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const [attempts, setAttempts] = useState(0);
  const query = useQuery<PaymentSync>({
    queryKey: [...qk.orders.all, 'sync', number ?? ''],
    queryFn: async () => {
      setAttempts((a) => a + 1);
      const result = await ordersApi.syncPayment(number as string);
      if (!isPaymentPending(result.payment.status)) {
        void qc.invalidateQueries({ queryKey: qk.orders.detail(number as string) });
      }
      return result;
    },
    enabled: enabled && Boolean(number),
    retry: 1,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (q) => {
      if (!isPaymentPending(q.state.data?.payment.status)) return false;
      if (attempts >= syncTuning.maxAttempts) return false;
      return syncTuning.delaysMs[Math.min(attempts - 1, syncTuning.delaysMs.length - 1)] ?? 20_000;
    },
  });
  const status = query.data?.payment.status;
  const settled = query.data !== undefined && !isPaymentPending(status);
  return {
    ...query,
    attempts,
    settled,
    gaveUp: !settled && attempts >= syncTuning.maxAttempts && !query.isFetching,
    verifying: enabled && !settled && !(attempts >= syncTuning.maxAttempts && !query.isFetching),
    recheck: () => {
      setAttempts(0);
      void query.refetch();
    },
  };
}
