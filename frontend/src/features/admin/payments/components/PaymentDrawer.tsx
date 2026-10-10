import { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Undo2 } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, ErrorState, Money, Sheet, SheetContent, Skeleton, StatusBadge } from '@/design';
import { useAdminPayment } from '@/lib/api/adminPayments';
import { formatDateTime } from '../../ops/format';
import { EventTimeline, Facts, FlaggedTag, RefundList, SandboxTag } from './PaymentParts';
import { RefundDialog } from './RefundDialog';

export function PaymentDrawer({
  paymentId,
  onClose,
}: {
  paymentId: number | null;
  onClose: () => void;
}) {
  const { hasCapability } = useAuth();
  const { data: p, isPending, isError, error, refetch, isFetching } = useAdminPayment(paymentId);
  const [refundOpen, setRefundOpen] = useState(false);
  const canRefund = hasCapability('payments.refund');

  return (
    <Sheet open={paymentId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        title={p ? `Payment #${p.id}` : 'Payment'}
        description="Payment details, refunds and provider events"
        data-theme="admin"
        className="w-[min(34rem,100vw)]"
      >
        <div className="grid gap-5 p-5">
          {isPending ? (
            <div aria-busy="true" className="grid gap-3">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-32" />
              <Skeleton className="h-40" />
            </div>
          ) : isError || !p ? (
            <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
          ) : (
            <>
              <section>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="payment" status={p.status} />
                  {p.is_sandbox ? <SandboxTag provider={p.provider} /> : null}
                  <FlaggedTag reason={p.flagged_reason} />
                </div>
                <p className="mt-2 font-display text-3xl font-semibold tabular-nums">
                  <Money value={p.amount} />
                </p>
                <p className="text-sm text-text-muted">{p.provider_label}</p>
                {p.needs_refund ? (
                  <p
                    role="status"
                    className="mt-2 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning"
                  >
                    {p.flagged_reason === 'duplicate_charge'
                      ? 'This looks like a duplicate charge. The customer should get this money back.'
                      : 'The order was cancelled but this payment has not been fully refunded.'}
                  </p>
                ) : null}
                {p.failure_message ? (
                  <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
                    {p.failure_message}
                    {p.failure_code ? ` (${p.failure_code})` : ''}
                  </p>
                ) : null}
              </section>

              <section aria-label="Details">
                <Facts
                  rows={[
                    [
                      'Order',
                      <Link
                        key="o"
                        to={`/admin/orders/${encodeURIComponent(p.order.number)}`}
                        className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                      >
                        {p.order.number} <ExternalLink aria-hidden="true" className="size-3" />
                      </Link>,
                    ],
                    ['Customer', `${p.order.customer_name} · ${p.order.customer_email}`],
                    ['Branch', p.order.branch_name],
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
                    ['Created', formatDateTime(p.created_at)],
                    ['Paid', p.paid_at ? formatDateTime(p.paid_at) : ''],
                    ['Refunded', <Money key="r" value={p.refunded_total} />],
                    ['Still refundable', <Money key="rr" value={p.refundable_amount} />],
                  ]}
                />
              </section>

              {p.provider === 'stripe' && !p.provider_is_available ? (
                <p role="note" className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
                  Stripe is not configured in this environment, so this payment cannot be refunded
                  or re-checked from here. Handle the real charge in the Stripe dashboard.
                </p>
              ) : null}

              {canRefund ? (
                <section className="rounded-md border border-border p-3">
                  <h3 className="font-sans text-sm font-semibold">Refund</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    Refunds are sent to the payment provider and the result is shown to you.
                    Cancelling an order does not refund it.
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    disabled={
                      !p.can_refund || (p.provider === 'stripe' && !p.provider_is_available)
                    }
                    onClick={() => setRefundOpen(true)}
                    leadingIcon={<Undo2 aria-hidden="true" className="size-4" />}
                  >
                    Refund…
                  </Button>
                  {!p.can_refund ? (
                    <p className="mt-2 text-xs text-text-muted">
                      {Number(p.refundable_amount) <= 0
                        ? 'Nothing left to refund on this payment.'
                        : 'This payment cannot be refunded right now.'}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section>
                <h3 className="mb-2 font-sans text-sm font-semibold">Refunds</h3>
                <RefundList refunds={p.refunds} />
              </section>
              <section>
                <h3 className="mb-2 font-sans text-sm font-semibold">Provider events</h3>
                <EventTimeline events={p.events} />
              </section>
              <RefundDialog payment={p} open={refundOpen} onOpenChange={setRefundOpen} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
