import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/design';
import { describeError } from '@/lib/api/errors';
import { qk } from '@/lib/api/keys';
import { usePayOrder } from '@/lib/api/orders';
import { resolvePaymentAction } from '@/features/checkout/paymentAction';

/** Start (or restart) payment for an order and follow the provider action the server returns. */
export function usePayAndFollow() {
  const pay = usePayOrder();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const start = (number: string, method?: string) => {
    setError(null);
    pay.mutate(
      { number, method },
      {
        onSuccess: (info) => {
          const action = resolvePaymentAction(info.action);
          if (action.kind === 'external') {
            window.location.assign(action.url);
          } else if (action.kind === 'internal') {
            navigate(action.to);
          } else if (info.error) {
            setError(info.error.message);
          } else {
            toast.success('Payment updated.');
            void qc.invalidateQueries({ queryKey: qk.orders.all });
          }
        },
        onError: (e) => setError(describeError(e).message),
      },
    );
  };
  return { start, pending: pay.isPending, error };
}
