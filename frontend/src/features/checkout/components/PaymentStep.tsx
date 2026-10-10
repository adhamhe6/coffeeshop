import { useEffect } from 'react';
import { Banknote, CreditCard, FlaskConical } from 'lucide-react';
import { Badge, RadioCard, RadioGroup, Skeleton } from '@/design';
import { usePaymentMethods, type PaymentMethod } from '@/lib/api/checkout';
import type { OrderType } from '@/lib/api/orders';

export function paymentCopy(method: PaymentMethod, orderType: OrderType) {
  if (method.offline) {
    return {
      title: method.label,
      description:
        orderType === 'DELIVERY'
          ? 'Pay when your order arrives. Nothing is charged now.'
          : 'Pay when you collect your order. Nothing is charged now.',
    };
  }
  return { title: method.label, description: method.description ?? '' };
}

/** Payment methods from `payments/methods/`. Sandbox methods are labelled so nobody thinks money moves. */
export function PaymentStep({
  value,
  orderType,
  onChange,
}: {
  value: string | null;
  orderType: OrderType;
  onChange: (key: string) => void;
}) {
  const methods = usePaymentMethods();
  const first = methods.data?.[0]?.key;
  useEffect(() => {
    if (!value && first) onChange(first);
  }, [value, first, onChange]);

  if (methods.isPending) return <Skeleton className="h-20" />;
  if (methods.isError || !methods.data?.length) {
    return (
      <p role="alert" className="text-sm font-medium text-danger">
        No payment methods are available right now. Please try again shortly.
      </p>
    );
  }
  return (
    <RadioGroup value={value ?? ''} onValueChange={onChange} aria-label="Payment method">
      {methods.data.map((method) => {
        const copy = paymentCopy(method, orderType);
        return (
          <RadioCard
            key={method.key}
            value={method.key}
            icon={
              method.offline ? (
                <Banknote aria-hidden="true" />
              ) : method.is_sandbox ? (
                <FlaskConical aria-hidden="true" />
              ) : (
                <CreditCard aria-hidden="true" />
              )
            }
            title={copy.title}
            description={
              <>
                {method.is_sandbox ? null : <span className="block">{copy.description}</span>}
                {method.is_sandbox ? (
                  <Badge tone="info" className="mt-1.5">
                    <FlaskConical aria-hidden="true" /> Sandbox — no real money moves
                  </Badge>
                ) : null}
              </>
            }
          />
        );
      })}
    </RadioGroup>
  );
}
