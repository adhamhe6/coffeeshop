import { Money } from '@/design';
import { useStore } from '@/lib/api/store';
import type { AdminOrderDetail } from '@/lib/api/adminOrders';
import { formatDateTime } from '../../ops/format';
import { ORDER_TYPE_LABEL, paymentMethodLabel } from './orderMeta';

interface Address {
  recipient_name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  postal_code?: string;
  instructions?: string;
  phone?: string;
}

/**
 * Clean printable ticket for the kitchen / handover. It is only visible when printing (`hidden print:block`):
 * the rest of the admin chrome is hidden by `print:hidden` on the layout and page.
 * No internal notes, no provider references: nothing the customer should not see on a paper slip.
 */
export function OrderTicket({ order }: { order: AdminOrderDetail }) {
  const { data: store } = useStore();
  const addr = (
    order.delivery_address && typeof order.delivery_address === 'object'
      ? order.delivery_address
      : {}
  ) as Address;
  const cashDue =
    order.payment_method === 'cash' &&
    !['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.payment_status);
  return (
    <article
      aria-label={`Printable ticket for order ${order.number}`}
      data-testid="order-ticket"
      className="hidden max-w-[80mm] bg-white font-sans text-black print:block"
    >
      <header className="border-b-2 border-black pb-2 text-center">
        <p className="text-sm font-semibold tracking-wide uppercase">
          {store?.brand_name ?? 'Order ticket'}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{order.number}</p>
        <p className="text-base font-semibold uppercase">
          {ORDER_TYPE_LABEL[order.order_type] ?? order.order_type} · {order.branch.name}
        </p>
        <p className="text-xs">Placed {formatDateTime(order.placed_at)}</p>
        <p className="text-xs">
          {order.requested_for
            ? `For ${formatDateTime(order.requested_for)}`
            : 'As soon as possible'}
        </p>
      </header>

      <section className="border-b border-black py-2 text-sm">
        <p className="font-semibold">{order.customer.name}</p>
        {order.customer.phone ? <p>{order.customer.phone}</p> : null}
        {order.order_type === 'DELIVERY' ? (
          <address className="mt-1 not-italic">
            {[addr.line1, addr.line2].filter(Boolean).join(', ')}
            <br />
            {[addr.city, addr.postal_code].filter(Boolean).join(', ')}
            {addr.instructions ? (
              <>
                <br />
                <strong>Instructions:</strong> {addr.instructions}
              </>
            ) : null}
          </address>
        ) : null}
        {order.customer_notes ? (
          <p className="mt-1">
            <strong>Customer note:</strong> {order.customer_notes}
          </p>
        ) : null}
      </section>

      <section className="border-b border-black py-2">
        <ul className="grid gap-2 text-sm">
          {order.items.map((it) => (
            <li key={it.id}>
              <p className="flex justify-between gap-2 font-semibold">
                <span>
                  {it.quantity} × {it.product_name}
                </span>
                <Money value={it.line_total} />
              </p>
              {it.options.map((o, i) => (
                <p key={i} className="pl-4 text-xs">
                  {o.group_name}: {o.option_name}
                </p>
              ))}
              {it.note ? <p className="pl-4 text-xs font-semibold">Note: {it.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="py-2 text-sm">
        <p className="flex justify-between">
          <span>Subtotal</span>
          <Money value={order.totals.subtotal} />
        </p>
        {Number(order.totals.discount_total) > 0 ? (
          <p className="flex justify-between">
            <span>Discount</span>
            <span>
              −<Money value={order.totals.discount_total} />
            </span>
          </p>
        ) : null}
        {order.order_type === 'DELIVERY' ? (
          <p className="flex justify-between">
            <span>Delivery</span>
            <Money value={order.totals.delivery_fee} />
          </p>
        ) : null}
        <p className="flex justify-between">
          <span>Tax</span>
          <Money value={order.totals.tax_total} />
        </p>
        <p className="mt-1 flex justify-between border-t border-black pt-1 text-base font-bold">
          <span>Total</span>
          <Money value={order.totals.total} />
        </p>
        <p className="mt-2 text-center text-base font-bold uppercase">
          {cashDue
            ? `Collect cash: `
            : `${paymentMethodLabel(order.payment_method)} · ${order.payment_status.replace(/_/g, ' ')}`}
          {cashDue ? <Money value={order.totals.total} /> : null}
        </p>
      </section>
    </article>
  );
}
