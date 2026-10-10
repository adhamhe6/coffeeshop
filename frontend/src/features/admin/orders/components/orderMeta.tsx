import { Bike, Store, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/design';

export const ORDER_TYPE_LABEL: Record<string, string> = { PICKUP: 'Pickup', DELIVERY: 'Delivery' };

export function OrderTypeLabel({ type }: { type: string }) {
  const Icon = type === 'DELIVERY' ? Bike : Store;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className="size-3.5 text-text-muted" />
      {ORDER_TYPE_LABEL[type] ?? type}
    </span>
  );
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  stripe: 'Card (Stripe)',
  demo: 'Demo card (sandbox)',
  cash: 'Cash',
};
export const paymentMethodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? m;

export const ORDER_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const PAYMENT_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Payment pending' },
  { value: 'REQUIRES_ACTION', label: 'Action required' },
  { value: 'AUTHORIZED', label: 'Authorised' },
  { value: 'PAID', label: 'Paid' },
  { value: 'FAILED', label: 'Payment failed' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
];

export const ORDER_TYPE_OPTIONS = [
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'DELIVERY', label: 'Delivery' },
];
export const PAYMENT_METHOD_OPTIONS = [
  { value: 'stripe', label: 'Card (Stripe)' },
  { value: 'demo', label: 'Demo card (sandbox)' },
  { value: 'cash', label: 'Cash' },
];

/** Action labels per target status: verbs, in the order staff do them. */
export const TRANSITION_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirm order',
  PREPARING: 'Start preparing',
  READY_FOR_PICKUP: 'Mark ready for pickup',
  OUT_FOR_DELIVERY: 'Send out for delivery',
  COMPLETED: 'Mark completed',
};

export function AttentionNote({ message }: { message: ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-xs font-medium text-warning">
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>{message}</span>
    </span>
  );
}

/** Payment chip for an order. A cash order that has not been collected yet reads "Pay at pickup", not "pending". */
export function OrderPaymentBadge({ status, method }: { status: string; method: string }) {
  const display = method === 'cash' && status === 'PENDING' ? 'UNPAID' : status;
  return <StatusBadge kind="payment" status={display} />;
}
