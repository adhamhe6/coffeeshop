import type { ComponentType, SVGProps } from 'react';
import {
  Ban,
  Bike,
  CircleCheckBig,
  CircleDollarSign,
  Clock,
  CookingPot,
  CreditCard,
  Hourglass,
  PackageCheck,
  ShieldAlert,
  Undo2,
  Wallet,
} from 'lucide-react';
import { Badge, type BadgeTone } from './Badge';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
interface StatusMeta {
  label: string;
  tone: BadgeTone;
  icon: IconType;
}

export const ORDER_STATUS: Record<string, StatusMeta> = {
  PENDING: { label: 'Pending', tone: 'warning', icon: Clock },
  CONFIRMED: { label: 'Confirmed', tone: 'info', icon: CircleCheckBig },
  PREPARING: { label: 'Preparing', tone: 'accent', icon: CookingPot },
  READY_FOR_PICKUP: { label: 'Ready for pickup', tone: 'success', icon: PackageCheck },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'info', icon: Bike },
  COMPLETED: { label: 'Completed', tone: 'success', icon: CircleCheckBig },
  CANCELLED: { label: 'Cancelled', tone: 'danger', icon: Ban },
};

export const PAYMENT_STATUS: Record<string, StatusMeta> = {
  PENDING: { label: 'Payment pending', tone: 'warning', icon: Hourglass },
  REQUIRES_ACTION: { label: 'Action required', tone: 'warning', icon: ShieldAlert },
  AUTHORIZED: { label: 'Authorised', tone: 'info', icon: CreditCard },
  PAID: { label: 'Paid', tone: 'success', icon: CircleDollarSign },
  FAILED: { label: 'Payment failed', tone: 'danger', icon: Ban },
  CANCELLED: { label: 'Payment cancelled', tone: 'neutral', icon: Ban },
  PARTIALLY_REFUNDED: { label: 'Partially refunded', tone: 'info', icon: Undo2 },
  REFUNDED: { label: 'Refunded', tone: 'neutral', icon: Undo2 },
  UNPAID: { label: 'Pay at pickup', tone: 'neutral', icon: Wallet },
};

export interface StatusBadgeProps {
  kind: 'order' | 'payment';
  status: string;
  className?: string;
}

const humanise = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

/** Status chip: always icon + text label, colour is only reinforcement. */
export function StatusBadge({ kind, status, className }: StatusBadgeProps) {
  const table = kind === 'order' ? ORDER_STATUS : PAYMENT_STATUS;
  const meta = table[status] ?? { label: humanise(status), tone: 'neutral' as const, icon: Clock };
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} className={className} data-status={status}>
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}
