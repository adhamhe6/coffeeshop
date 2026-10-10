import { Link, useParams, useSearchParams } from 'react-router';
import {
  Ban,
  CircleCheckBig,
  Clock,
  FlaskConical,
  Hourglass,
  PackageSearch,
  ShoppingBag,
  TriangleAlert,
} from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, Container, EmptyState, ErrorState, Skeleton, Spinner } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { isApiError } from '@/lib/api/errors';
import { useOrder, type Order } from '@/lib/api/orders';
import {
  FulfilmentDetails,
  OrderItems,
  OrderTotals,
  PaymentBadges,
} from '../components/OrderParts';
import { usePayAndFollow } from '../usePayAndFollow';
import { usePaymentSync } from '../usePaymentSync';

type View = 'verifying' | 'paid' | 'cash' | 'waiting' | 'failed' | 'unpaid';

function nextSteps(order: Order, view: View): string[] {
  const pickup = order.order_type === 'PICKUP';
  if (view === 'failed' || view === 'unpaid' || view === 'waiting') {
    return [
      'We will not start your order until payment is confirmed.',
      'You can try paying again from the order page; your items are kept.',
      'Unpaid orders are cancelled automatically after a while, and nothing is charged.',
    ];
  }
  return [
    `${order.branch.name} reviews your order and starts preparing it.`,
    pickup
      ? 'You will get a notification when it is ready to collect.'
      : 'You will get a notification when it is out for delivery.',
    order.payment_method === 'cash'
      ? pickup
        ? 'Pay at the counter when you collect it.'
        : 'Pay the courier when it arrives.'
      : 'Your payment is already taken care of.',
    'Follow every step on the order page.',
  ];
}

function Headline({ view, order, name }: { view: View; order: Order; name: string }) {
  const first = name ? `, ${name}` : '';
  const content: Record<
    View,
    { icon: React.ReactNode; title: string; text: string; tone: string }
  > = {
    verifying: {
      icon: <Spinner label={null} className="size-7" />,
      title: 'Checking your payment…',
      text: 'We are confirming with the payment provider. This usually takes a few seconds. Please keep this page open.',
      tone: 'bg-info-bg text-info',
    },
    paid: {
      icon: <CircleCheckBig aria-hidden="true" className="size-7" />,
      title: `Thank you${first}. Your order is in.`,
      text: `Payment confirmed. We have sent order ${order.number} to ${order.branch.name}.`,
      tone: 'bg-success-bg text-success',
    },
    cash: {
      icon: <CircleCheckBig aria-hidden="true" className="size-7" />,
      title: `Thank you${first}. Your order is placed.`,
      text:
        order.order_type === 'PICKUP'
          ? 'Nothing was charged online: you pay when you collect it.'
          : 'Nothing was charged online: you pay when it arrives.',
      tone: 'bg-success-bg text-success',
    },
    waiting: {
      icon: <Hourglass aria-hidden="true" className="size-7" />,
      title: 'Still waiting for payment confirmation',
      text: 'The provider has not confirmed your payment yet. If you completed it, it can take a little longer. We keep checking in the background and will notify you; you can also check again now.',
      tone: 'bg-warning-bg text-warning',
    },
    failed: {
      icon: <Ban aria-hidden="true" className="size-7" />,
      title: 'Payment did not go through',
      text: 'Your order is saved but not paid. You were not charged. Try again to complete it.',
      tone: 'bg-danger-bg text-danger',
    },
    unpaid: {
      icon: <Clock aria-hidden="true" className="size-7" />,
      title: 'Your order is waiting for payment',
      text: 'Payment has not been completed yet. Finish paying to send the order to the team.',
      tone: 'bg-warning-bg text-warning',
    },
  };
  const c = content[view];
  return (
    <div className="flex items-start gap-4">
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-full ${c.tone}`}
        aria-hidden="true"
      >
        {c.icon}
      </span>
      <div>
        <h1 className="text-h2" data-testid="confirmation-title">
          {c.title}
        </h1>
        <p className="mt-2 max-w-prose text-lead text-text-muted">{c.text}</p>
      </div>
    </div>
  );
}

export default function OrderConfirmationPage() {
  const { number = '' } = useParams();
  useSeo({ title: `Order ${number}`, noindex: true });
  const [params] = useSearchParams();
  const { user } = useAuth();
  const returning = params.get('payment') === 'return';
  const order = useOrder(number);
  const sync = usePaymentSync(number, returning);
  const payAgain = usePayAndFollow();

  if (order.isPending) {
    return (
      <Container size="narrow" className="py-12" aria-busy="true">
        <Skeleton className="mb-6 h-16" />
        <Skeleton className="h-72" />
      </Container>
    );
  }
  if (order.isError) {
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
          <ErrorState error={order.error} onRetry={() => void order.refetch()} />
        )}
      </Container>
    );
  }

  const o = order.data;
  const paymentStatus = sync.data?.payment.status ?? o.payment_status;
  const paid = ['PAID', 'AUTHORIZED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(paymentStatus);
  const failed = ['FAILED', 'CANCELLED'].includes(paymentStatus);
  const offline = o.payment_method === 'cash';
  const view: View = paid
    ? 'paid'
    : failed
      ? 'failed'
      : returning && sync.verifying
        ? 'verifying'
        : returning && sync.gaveUp
          ? 'waiting'
          : offline
            ? 'cash'
            : 'unpaid';
  const sandbox = (sync.data?.payment ?? o.payment).is_sandbox;
  const canPay =
    o.actions.can_pay && (view === 'failed' || view === 'unpaid' || view === 'waiting');

  return (
    <Container size="narrow" className="py-10 md:py-14">
      <div role="status" aria-live="polite">
        <Headline view={view} order={o} name={user?.first_name ?? ''} />
      </div>

      {sandbox ? (
        <p className="mt-5 flex items-center gap-2 rounded-md bg-info-bg px-3.5 py-2.5 text-sm font-medium text-info">
          <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
          Sandbox payment — no real money moved.
        </p>
      ) : null}

      {view === 'waiting' ? (
        <div className="mt-5">
          <Button variant="secondary" onClick={sync.recheck} loading={sync.isFetching}>
            Check again
          </Button>
        </div>
      ) : null}

      {payAgain.error ? (
        <p role="alert" className="mt-5 flex items-start gap-2 text-sm font-medium text-danger">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {payAgain.error}
        </p>
      ) : null}

      <section
        aria-labelledby="summary-title"
        className="mt-8 rounded-lg border border-border bg-surface-raised"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:px-6">
          <div>
            <p className="eyebrow text-text-muted">Order number</p>
            <h2
              id="summary-title"
              className="font-display text-h3 font-semibold"
              data-testid="order-number"
            >
              {o.number}
            </h2>
          </div>
          <PaymentBadges
            payment={sync.data?.payment ?? o.payment}
            method={o.payment_method}
            status={paymentStatus}
          />
        </header>
        <div className="grid gap-6 p-5 sm:p-6">
          <FulfilmentDetails order={o} />
          <div className="border-t border-border pt-6">
            <OrderItems order={o} />
          </div>
          <div className="border-t border-border pt-6">
            <OrderTotals order={o} />
          </div>
        </div>
      </section>

      <section aria-labelledby="next-title" className="mt-8">
        <h2 id="next-title" className="font-display text-h4 font-semibold">
          What happens next
        </h2>
        <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-[0.9375rem] text-text-muted marker:font-medium marker:text-text">
          {nextSteps(o, view).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        {canPay ? (
          <Button
            onClick={() => payAgain.start(o.number)}
            loading={payAgain.pending}
            loadingText="Starting payment…"
          >
            {view === 'failed' ? 'Try payment again' : 'Pay now'}
          </Button>
        ) : null}
        <Button asChild variant={canPay ? 'secondary' : 'primary'}>
          <Link to={`/orders/${encodeURIComponent(o.number)}`}>Track your order</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/menu">
            <ShoppingBag aria-hidden="true" className="size-4" /> Continue shopping
          </Link>
        </Button>
      </div>
    </Container>
  );
}
