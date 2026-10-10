import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Mail, MapPin, Phone, StickyNote, Store } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Badge, Button, Field, Money, StatusBadge, Textarea, toast } from '@/design';
import { useAddOrderNote, type AdminOrderDetail } from '@/lib/api/adminOrders';
import { isApiError } from '@/lib/api/errors';
import { Panel } from '../../ops/PageHeader';
import { formatDateTime, formatAge } from '../../ops/format';
import {
  EventTimeline,
  Facts,
  FlaggedTag,
  RefundList,
  SandboxTag,
} from '../../payments/components/PaymentParts';
import { OrderPaymentBadge, paymentMethodLabel } from './orderMeta';

export function OrderItems({ order }: { order: AdminOrderDetail }) {
  return (
    <Panel
      title="Items"
      description={`${order.item_count} item${order.item_count === 1 ? '' : 's'}`}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {order.items.map((it) => (
          <li key={it.id} className="grid grid-cols-[auto_1fr_auto] gap-x-3 px-4 py-3 text-sm">
            <span className="font-semibold tabular-nums">{it.quantity}×</span>
            <div className="min-w-0">
              <p className="font-medium">{it.product_name}</p>
              {it.options.length > 0 ? (
                <ul className="mt-0.5 text-text-muted">
                  {it.options.map((o, i) => (
                    <li key={`${o.group_name}-${o.option_name}-${i}`}>
                      {o.group_name}: {o.option_name}
                      {Number(o.price_delta) !== 0 ? (
                        <>
                          {' '}
                          (<Money value={o.price_delta} signed />)
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {it.note ? (
                <p className="mt-1 flex items-start gap-1.5 rounded-sm bg-warning-bg px-2 py-1 text-warning">
                  <StickyNote aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-semibold">Note: </span>
                    {it.note}
                  </span>
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-text-muted">
                {it.sku} · <Money value={it.unit_price} /> each
              </p>
            </div>
            <div className="text-right">
              <Money value={it.line_total} className="font-medium" />
              {Number(it.discount_amount) > 0 ? (
                <p className="text-xs text-text-muted">
                  −<Money value={it.discount_amount} /> discount
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function OrderTotals({ order }: { order: AdminOrderDetail }) {
  const t = order.totals;
  const row = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
    <div
      className={
        strong
          ? 'flex justify-between border-t border-border pt-2 text-base font-semibold'
          : 'flex justify-between'
      }
    >
      <dt className={strong ? '' : 'text-text-muted'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <Panel title="Totals">
      <dl className="grid gap-1.5 text-sm">
        {row('Subtotal', <Money value={t.subtotal} />)}
        {Number(t.discount_total) > 0
          ? row(
              <>
                Discount
                {t.coupon_code ? (
                  <span className="ml-1.5 rounded-xs bg-surface-sunken px-1.5 py-0.5 text-xs font-medium text-text">
                    {t.coupon_code}
                  </span>
                ) : null}
              </>,
              <>
                −<Money value={t.discount_total} />
              </>,
            )
          : null}
        {order.order_type === 'DELIVERY'
          ? row('Delivery fee', <Money value={t.delivery_fee} />)
          : null}
        {row(
          `Tax (${Number(t.tax_rate)}%${t.prices_include_tax ? ', included in prices' : ''})`,
          <Money value={t.tax_total} />,
        )}
        {row('Total', <Money value={t.total} />, true)}
        {Number(t.refunded_total) > 0
          ? row(
              'Refunded',
              <>
                −<Money value={t.refunded_total} />
              </>,
            )
          : null}
      </dl>
    </Panel>
  );
}

export function OrderPayments({ order }: { order: AdminOrderDetail }) {
  const { hasCapability } = useAuth();
  const canOpen = hasCapability('payments.view');
  return (
    <Panel
      title="Payments"
      description="Payment attempts for this order. Refunds go through the payment provider; cancelling an order does not refund it."
    >
      {order.payments.length === 0 ? (
        <p className="text-sm text-text-muted">
          No payment has been started for this order
          {order.payment_method === 'cash' ? ' (cash is recorded when it is collected).' : '.'}
        </p>
      ) : (
        <ul className="grid gap-4">
          {order.payments.map((p) => (
            <li key={p.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.provider_label}</span>
                <StatusBadge kind="payment" status={p.status} />
                {p.is_sandbox ? <SandboxTag provider={p.provider} /> : null}
                <FlaggedTag reason={p.flagged_reason} />
                <Money value={p.amount} className="ml-auto font-semibold" />
              </div>
              {!p.provider_is_available && p.provider === 'stripe' ? (
                <p
                  className="mt-2 rounded-sm bg-warning-bg px-2.5 py-1.5 text-sm text-warning"
                  role="note"
                >
                  Stripe is not configured in this environment, so this payment cannot be refunded
                  or re-checked here. Use the Stripe dashboard for the real charge.
                </p>
              ) : null}
              <div className="mt-2">
                <Facts
                  rows={[
                    [
                      'Reference',
                      p.reference ? <code className="text-xs">{p.reference}</code> : '',
                    ],
                    [
                      'Provider charge',
                      p.provider_charge_id ? (
                        <code className="text-xs">{p.provider_charge_id}</code>
                      ) : (
                        ''
                      ),
                    ],
                    ['Paid at', p.paid_at ? formatDateTime(p.paid_at) : ''],
                    ['Started', formatDateTime(p.created_at)],
                    [
                      'Refunded so far',
                      Number(p.refunded_total) > 0 ? <Money value={p.refunded_total} /> : '',
                    ],
                    ['Failure', p.failure_message || p.failure_code],
                  ]}
                />
              </div>
              {p.refunds.length > 0 ? (
                <div className="mt-3">
                  <h4 className="mb-1.5 font-sans text-xs font-semibold tracking-wide text-text-muted uppercase">
                    Refunds
                  </h4>
                  <RefundList refunds={p.refunds} />
                </div>
              ) : null}
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer rounded-xs py-1 text-text-muted hover:text-text">
                  Provider events ({p.events.length})
                </summary>
                <div className="mt-2">
                  <EventTimeline events={p.events} />
                </div>
              </details>
              {canOpen ? (
                <p className="mt-2 flex flex-wrap items-center gap-3">
                  <Link
                    to={`/admin/payments?payment=${p.id}`}
                    className="inline-flex items-center gap-1 rounded-xs text-sm font-medium text-accent-text underline-offset-4 hover:underline"
                  >
                    {p.can_refund ? 'Open to refund' : 'Open in Payments'}
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

interface Address {
  recipient_name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  postal_code?: string;
  zone?: string;
  phone?: string;
  instructions?: string;
}

export function OrderCustomer({ order }: { order: AdminOrderDetail }) {
  const addr = (
    order.delivery_address && typeof order.delivery_address === 'object'
      ? order.delivery_address
      : {}
  ) as Address;
  return (
    <Panel title="Customer">
      <p className="font-medium">{order.customer.name}</p>
      <ul className="mt-1.5 grid gap-1 text-sm">
        {order.customer.email ? (
          <li className="flex items-center gap-2">
            <Mail aria-hidden="true" className="size-4 text-text-muted" />
            <a
              href={`mailto:${order.customer.email}`}
              className="break-all underline-offset-4 hover:underline"
            >
              {order.customer.email}
            </a>
          </li>
        ) : null}
        {order.customer.phone ? (
          <li className="flex items-center gap-2">
            <Phone aria-hidden="true" className="size-4 text-text-muted" />
            <a href={`tel:${order.customer.phone}`} className="underline-offset-4 hover:underline">
              {order.customer.phone}
            </a>
          </li>
        ) : null}
      </ul>
      {order.customer_notes ? (
        <p className="mt-3 rounded-sm bg-warning-bg px-2.5 py-1.5 text-sm text-warning">
          <span className="font-semibold">Customer note: </span>
          {order.customer_notes}
        </p>
      ) : null}
      <div className="mt-4 border-t border-border pt-3 text-sm">
        {order.order_type === 'DELIVERY' ? (
          <>
            <p className="flex items-center gap-2 font-medium">
              <MapPin aria-hidden="true" className="size-4 text-text-muted" /> Delivery address
            </p>
            <address className="mt-1 not-italic">
              {addr.recipient_name ? <span className="block">{addr.recipient_name}</span> : null}
              {addr.line1 ? <span className="block">{addr.line1}</span> : null}
              {addr.line2 ? <span className="block">{addr.line2}</span> : null}
              <span className="block">
                {[addr.city, addr.postal_code].filter(Boolean).join(', ')}
              </span>
              {order.delivery_zone_name || addr.zone ? (
                <span className="block text-text-muted">
                  Zone: {order.delivery_zone_name || addr.zone}
                </span>
              ) : null}
            </address>
            {addr.instructions ? (
              <p className="mt-2 rounded-sm bg-warning-bg px-2.5 py-1.5 text-warning">
                <span className="font-semibold">Instructions: </span>
                {addr.instructions}
              </p>
            ) : null}
          </>
        ) : (
          <p className="flex items-center gap-2">
            <Store aria-hidden="true" className="size-4 text-text-muted" />
            Pickup at <span className="font-medium">{order.branch.name}</span>
          </p>
        )}
      </div>
    </Panel>
  );
}

export function OrderHistory({ order }: { order: AdminOrderDetail }) {
  const entries = [...order.history].reverse();
  return (
    <Panel title="Status history">
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">No history yet.</p>
      ) : (
        <ol className="relative grid gap-3 border-l border-border-strong pl-4">
          {entries.map((h, i) => (
            <li key={`${h.created_at}-${i}`} className="text-sm">
              <span
                aria-hidden="true"
                className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface-raised bg-border-strong"
              />
              <p className="flex flex-wrap items-center gap-1.5">
                {h.from_status ? (
                  <>
                    <StatusBadge kind="order" status={h.from_status} />
                    <span aria-label="to" className="text-text-muted">
                      →
                    </span>
                  </>
                ) : null}
                <StatusBadge kind="order" status={h.to_status} />
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {formatDateTime(h.created_at)} · {h.actor_label || 'system'}
              </p>
              {h.note ? <p className="mt-0.5">{h.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function OrderNotes({
  order,
  noteRef,
}: {
  order: AdminOrderDetail;
  noteRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const add = useAddOrderNote(order.number);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const text = body.trim();
    if (!text) {
      setError('Write a note first.');
      return;
    }
    setError(null);
    try {
      await add.mutateAsync(text);
      setBody('');
      toast.success('Note added.');
    } catch (e) {
      setError(isApiError(e) ? (e.fields.body?.[0] ?? e.message) : 'The note could not be saved.');
    }
  };
  return (
    <Panel
      title="Internal notes"
      description="Only staff can see these. They are never shown to the customer."
    >
      {order.notes.length === 0 ? (
        <p className="mb-3 text-sm text-text-muted">No notes yet.</p>
      ) : (
        <ul className="mb-3 grid gap-2">
          {order.notes.map((n) => (
            <li key={n.id} className="rounded-md bg-surface-sunken p-2.5 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-text-muted">
                {n.author ?? 'Staff'} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {order.permissions.can_note ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="grid gap-2"
        >
          <Field label="Add a note" error={error ?? undefined}>
            <Textarea
              ref={noteRef as React.RefObject<HTMLTextAreaElement>}
              rows={3}
              maxLength={1000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={add.isPending}
              loadingText="Saving…"
            >
              Add note
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

export function useNoteRef() {
  return useRef<HTMLTextAreaElement | null>(null);
}

export function OrderFacts({ order }: { order: AdminOrderDetail }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-text-muted">
      <span>
        Placed {formatDateTime(order.placed_at)} ({formatAge(order.age_minutes)} ago)
      </span>
      <span>
        In this status for{' '}
        <span className="font-medium text-text">{formatAge(order.minutes_in_status)}</span>
      </span>
      {order.requested_for ? (
        <span>
          Scheduled for{' '}
          <span className="font-medium text-text">{formatDateTime(order.requested_for)}</span>
        </span>
      ) : (
        <span>As soon as possible</span>
      )}
      {order.estimated_ready_at ? (
        <span>Estimated ready {formatDateTime(order.estimated_ready_at)}</span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <OrderPaymentBadge status={order.payment_status} method={order.payment_method} />
        {paymentMethodLabel(order.payment_method)}
      </span>
      {order.is_demo ? <Badge tone="neutral">Demo order</Badge> : null}
    </div>
  );
}
