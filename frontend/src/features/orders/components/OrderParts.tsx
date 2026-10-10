import { Link } from 'react-router';
import { FlaskConical, MapPin, Phone, Store } from 'lucide-react';
import { Badge, Money, ProductImage, StatusBadge } from '@/design';
import { OptionChips } from '@/features/cart/components/OptionChips';
import type { Order, PaymentInfo } from '@/lib/api/orders';
import { formatDateTime } from '../format';

const isZero = (v: string | undefined | null) => v === undefined || v === null || Number(v) === 0;

/** Payment status badge, plus a sandbox flag so a test payment can never be mistaken for a real one. */
export function PaymentBadges({
  payment,
  method,
  status,
}: {
  payment: PaymentInfo;
  method?: string;
  status: string;
}) {
  const offline = method === 'cash';
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge
        kind="payment"
        status={
          offline && (status === 'PENDING' || status === 'REQUIRES_ACTION') ? 'UNPAID' : status
        }
      />
      {payment.is_sandbox ? (
        <Badge tone="info">
          <FlaskConical aria-hidden="true" /> Sandbox
        </Badge>
      ) : null}
    </span>
  );
}

export function OrderItems({ order, withReview }: { order: Order; withReview?: boolean }) {
  return (
    <ul className="divide-y divide-border" aria-label="Items in this order">
      {order.items.map((item) => (
        <li key={item.id} className="flex gap-3.5 py-4 first:pt-0 last:pb-0">
          <ProductImage src={item.image} alt="" aspect="1/1" className="size-16 shrink-0" />
          <div className="grid min-w-0 flex-1 content-start gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">
                {item.quantity} × {item.product_name}
              </p>
              <Money value={item.line_total} className="shrink-0 font-medium" />
            </div>
            <OptionChips options={item.options} />
            {item.note ? <p className="text-sm text-text-muted italic">“{item.note}”</p> : null}
            {withReview && item.product_slug ? (
              <Link
                to={`/p/${item.product_slug}#reviews`}
                className="w-fit rounded-xs text-sm text-accent-text underline underline-offset-4"
              >
                Review {item.product_name}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Order totals exactly as stored on the order. */
export function OrderTotals({ order }: { order: Order }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Subtotal', <Money key="s" value={order.subtotal} />],
  ];
  if (!isZero(order.discount_total))
    rows.push([
      order.coupon_code ? `Discount (${order.coupon_code})` : 'Discount',
      <span key="d" className="text-success">
        −<Money value={order.discount_total} />
      </span>,
    ]);
  if (order.order_type === 'DELIVERY')
    rows.push([
      'Delivery fee',
      isZero(order.delivery_fee) ? 'Free' : <Money key="f" value={order.delivery_fee} />,
    ]);
  rows.push([
    order.prices_include_tax ? 'Tax (included)' : 'Tax',
    <Money key="t" value={order.tax_total} />,
  ]);
  return (
    <dl className="grid gap-2.5 text-[0.9375rem]" data-testid="order-totals">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-text-muted">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <dt className="font-semibold">Total</dt>
        <dd className="font-display text-xl font-semibold tabular-nums">
          <Money value={order.total} />
        </dd>
      </div>
      {!isZero(order.refunded_total) ? (
        <div className="flex items-baseline justify-between gap-4 text-info">
          <dt>Refunded</dt>
          <dd className="font-medium tabular-nums">
            <Money value={order.refunded_total} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Where and when: branch (and address for delivery), requested/estimated times, notes. */
export function FulfilmentDetails({ order }: { order: Order }) {
  const tz = order.branch.timezone;
  const delivery = order.order_type === 'DELIVERY';
  const address = order.delivery_address;
  return (
    <div className="grid gap-5 text-[0.9375rem] sm:grid-cols-2">
      <div className="grid content-start gap-1.5">
        <h3 className="eyebrow text-text-muted">{delivery ? 'Prepared at' : 'Pickup at'}</h3>
        <p className="flex items-start gap-2 font-medium">
          <Store aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
          {order.branch.name}
        </p>
        <p className="pl-6 text-text-muted">
          {order.branch.address_line}, {order.branch.city}
        </p>
        {order.branch.phone ? (
          <p className="flex items-center gap-2 pl-6 text-text-muted">
            <Phone aria-hidden="true" className="size-3.5" />
            <a href={`tel:${order.branch.phone}`} className="underline underline-offset-4">
              {order.branch.phone}
            </a>
          </p>
        ) : null}
      </div>
      {delivery && address ? (
        <div className="grid content-start gap-1.5">
          <h3 className="eyebrow text-text-muted">Delivering to</h3>
          <p className="flex items-start gap-2 font-medium">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
            {address.recipient_name}
          </p>
          <p className="pl-6 text-text-muted">
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ''}, {address.city}
            {address.postal_code ? ` ${address.postal_code}` : ''}
          </p>
          {address.zone ? <p className="pl-6 text-text-muted">{address.zone}</p> : null}
          {address.instructions ? (
            <p className="pl-6 text-text-muted">Instructions: {address.instructions}</p>
          ) : null}
        </div>
      ) : null}
      <div className="grid content-start gap-1.5">
        <h3 className="eyebrow text-text-muted">Timing</h3>
        <dl className="grid gap-1">
          {order.requested_for ? (
            <div className="flex gap-2">
              <dt className="text-text-muted">Scheduled for</dt>
              <dd className="font-medium">{formatDateTime(order.requested_for, tz)}</dd>
            </div>
          ) : null}
          {order.estimated_ready_at &&
          order.status !== 'COMPLETED' &&
          order.status !== 'CANCELLED' ? (
            <div className="flex gap-2">
              <dt className="text-text-muted">
                {delivery ? 'Estimated arrival' : 'Estimated ready'}
              </dt>
              <dd className="font-medium">{formatDateTime(order.estimated_ready_at, tz)}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="text-text-muted">Placed</dt>
            <dd>{formatDateTime(order.placed_at, tz)}</dd>
          </div>
          {order.completed_at ? (
            <div className="flex gap-2">
              <dt className="text-text-muted">Completed</dt>
              <dd>{formatDateTime(order.completed_at, tz)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      {order.customer_notes ? (
        <div className="grid content-start gap-1.5">
          <h3 className="eyebrow text-text-muted">Your notes</h3>
          <p className="text-text-muted italic">“{order.customer_notes}”</p>
        </div>
      ) : null}
    </div>
  );
}
