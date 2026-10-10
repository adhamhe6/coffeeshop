import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Ban,
  CircleAlert,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  Star,
  TriangleAlert,
} from 'lucide-react';
import {
  Button,
  Container,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  ErrorState,
  Field,
  Skeleton,
  StatusBadge,
  Textarea,
  toast,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { describeError, isApiError } from '@/lib/api/errors';
import {
  isTerminalOrder,
  useCancelOrder,
  useOrder,
  useReorder,
  type Order,
} from '@/lib/api/orders';
import {
  FulfilmentDetails,
  OrderItems,
  OrderTotals,
  PaymentBadges,
} from '../components/OrderParts';
import { OrderTimeline } from '../components/OrderTimeline';
import { formatDateTime } from '../format';
import { usePayAndFollow } from '../usePayAndFollow';

const ACTOR: Record<string, string> = {
  customer: 'You',
  staff: 'Lantern team',
  system: 'Automatic',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Order placed',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  OUT_FOR_DELIVERY: 'Out for delivery',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6"
    >
      <h2 id={id} className="mb-4 font-display text-h4 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function CancelDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const cancel = useCancelOrder();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    setError(null);
    cancel.mutate(
      { number: order.number, reason: reason.trim() },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(`Order ${order.number} was cancelled.`);
        },
        onError: (e) => setError(describeError(e).message),
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cancel this order?"
        description={`Order ${order.number} will be cancelled and cannot be restarted. If you have not paid, nothing is charged.`}
      >
        <div className="grid gap-4">
          <Field label="Reason" hint="Optional. Helps us improve.">
            <Textarea
              rows={2}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm font-medium text-danger">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="-mx-6 mt-5 -mb-5">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Keep my order
          </Button>
          <Button
            variant="danger"
            onClick={confirm}
            loading={cancel.isPending}
            loadingText="Cancelling…"
          >
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OrderTrackingPage() {
  const { number = '' } = useParams();
  useSeo({ title: `Order ${number}`, noindex: true });
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const order = useOrder(number, { poll: true });
  const reorder = useReorder();
  const payAgain = usePayAndFollow();
  const [cancelling, setCancelling] = useState(false);

  if (order.isPending) {
    return (
      <Container size="narrow" className="py-12" aria-busy="true">
        <Skeleton className="mb-6 h-14" />
        <Skeleton className="mb-4 h-40" />
        <Skeleton className="h-64" />
      </Container>
    );
  }
  if (order.isError && !order.data) {
    const missing = isApiError(order.error) && order.error.status === 404;
    return (
      <Container size="narrow" className="py-12">
        {missing ? (
          <EmptyState
            as="h1"
            icon={<PackageSearch aria-hidden="true" />}
            title="We could not find that order"
            description="Check the order number, or open your order history."
            action={
              <Button asChild>
                <Link to="/account/orders">Your orders</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            error={order.error}
            onRetry={() => void order.refetch()}
            retrying={order.isFetching}
          />
        )}
      </Container>
    );
  }

  const o = order.data;
  const tz = o.branch.timezone;
  const terminal = isTerminalOrder(o.status);
  const cancelled = o.status === 'CANCELLED';
  const notice = params.get('payment');
  const stateError = (location.state as { paymentError?: string } | null)?.paymentError;
  const firstReviewable = o.items.find((i) => i.product_slug);

  const onReorder = () =>
    reorder.mutate(o.number, {
      onSuccess: (result) => {
        if (result.skipped.length > 0) {
          toast.warning(
            `Added to your cart. Skipped: ${result.skipped.map((s) => `${s.name} (${s.message})`).join('; ')}`,
          );
        } else {
          toast.success('Your items are back in the cart.');
        }
        navigate('/cart');
      },
      onError: (e) => toast.error(describeError(e).message),
    });

  const paymentProblem = o.payment.failure_message ?? payAgain.error;

  return (
    <Container size="narrow" className="py-10 md:py-14">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-text-muted">Order</p>
          <h1 className="text-h2" data-testid="order-number">
            {o.number}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Placed {formatDateTime(o.placed_at, tz)} ·{' '}
            {o.order_type === 'PICKUP' ? 'Pickup' : 'Delivery'}
            {o.is_demo ? ' · Demo order' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="order" status={o.status} />
          <PaymentBadges payment={o.payment} method={o.payment_method} status={o.payment_status} />
        </div>
      </header>

      {notice === 'failed' || notice === 'cancelled' || stateError ? (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-bg p-4 text-danger"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="grid gap-1 text-sm">
            <p className="font-semibold">
              {notice === 'cancelled'
                ? 'Payment cancelled'
                : stateError
                  ? 'We could not start your payment'
                  : 'Payment declined'}
            </p>
            <p>
              {stateError ??
                (notice === 'cancelled'
                  ? 'You cancelled the payment. Nothing was charged and your order is not paid yet.'
                  : 'The card was declined. Nothing was charged and your order is not paid yet.')}{' '}
              {o.actions.can_pay ? 'You can try again below.' : null}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6">
        <Section title="Progress" id="progress-title">
          <p className="sr-only" role="status" aria-live="polite">
            Current status: {STATUS_LABEL[o.status] ?? o.status}
          </p>
          {cancelled ? (
            <div className="mb-5 flex items-start gap-3 rounded-md bg-danger-bg p-3.5 text-sm text-danger">
              <Ban aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">This order was cancelled</p>
                {o.cancel_reason ? <p>{o.cancel_reason}</p> : null}
                {o.cancelled_at ? <p>{formatDateTime(o.cancelled_at, tz)}</p> : null}
              </div>
            </div>
          ) : null}
          <OrderTimeline steps={o.timeline} timeZone={tz} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm text-text-muted">
            {terminal ? (
              <span>This order is {cancelled ? 'cancelled' : 'complete'}.</span>
            ) : (
              <span>This page updates by itself while your order is moving.</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void order.refetch()}
              loading={order.isFetching}
              leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
            >
              Refresh
            </Button>
          </div>
        </Section>

        <Section title="Payment" id="payment-title">
          <div className="grid gap-3 text-[0.9375rem]">
            <div className="flex flex-wrap items-center gap-3">
              <PaymentBadges
                payment={o.payment}
                method={o.payment_method}
                status={o.payment_status}
              />
              <span className="text-text-muted">{o.payment.provider_label}</span>
            </div>
            {o.payment.is_sandbox ? (
              <p className="text-sm text-text-muted">
                This was a sandbox payment: no real money moved.
              </p>
            ) : null}
            {o.payment_method === 'cash' && o.payment_status !== 'PAID' ? (
              <p className="text-text-muted">
                {o.order_type === 'PICKUP'
                  ? 'Pay when you collect your order.'
                  : 'Pay when your order arrives.'}
              </p>
            ) : null}
            {paymentProblem && o.actions.can_pay ? (
              <p role="alert" className="flex items-start gap-2 font-medium text-danger">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {paymentProblem}
              </p>
            ) : null}
            {o.actions.can_pay ? (
              <div>
                <Button
                  onClick={() => payAgain.start(o.number)}
                  loading={payAgain.pending}
                  loadingText="Starting payment…"
                >
                  {o.payment_status === 'FAILED' ? 'Try payment again' : 'Pay now'}
                </Button>
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="Pickup and delivery details" id="details-title">
          <FulfilmentDetails order={o} />
        </Section>

        <Section title="Items" id="items-title">
          <OrderItems order={o} withReview={o.actions.can_review} />
          <div className="mt-6 border-t border-border pt-5">
            <OrderTotals order={o} />
          </div>
        </Section>

        {o.history.length > 0 ? (
          <Section title="Status history" id="history-title">
            <ol className="grid gap-3 text-sm" aria-label="Status history">
              {[...o.history].reverse().map((h, i) => (
                <li
                  key={`${h.created_at}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
                >
                  <span>
                    <span className="font-medium">{STATUS_LABEL[h.to_status] ?? h.to_status}</span>
                    <span className="text-text-muted"> · {ACTOR[h.actor] ?? h.actor}</span>
                    {h.note && h.note !== 'Order placed' ? (
                      <span className="text-text-muted"> · {h.note}</span>
                    ) : null}
                  </span>
                  <span className="text-text-muted tabular-nums">
                    {formatDateTime(h.created_at, tz)}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {o.actions.can_reorder ? (
            <Button
              variant="secondary"
              onClick={onReorder}
              loading={reorder.isPending}
              leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />}
            >
              Order again
            </Button>
          ) : null}
          {o.actions.can_review && firstReviewable?.product_slug ? (
            <Button asChild variant="secondary">
              <Link to={`/p/${firstReviewable.product_slug}#reviews`}>
                <Star aria-hidden="true" className="size-4" /> Leave a review
              </Link>
            </Button>
          ) : null}
          {o.actions.can_cancel ? (
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              Cancel order
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link to="/account/orders">All your orders</Link>
          </Button>
        </div>
      </div>
      {o.actions.can_cancel ? (
        <CancelDialog order={o} open={cancelling} onOpenChange={setCancelling} />
      ) : null}
    </Container>
  );
}
