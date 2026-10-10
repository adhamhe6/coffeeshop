import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Ban, CircleCheckBig, CreditCard, FlaskConical, LogIn, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Badge, Button, Container, EmptyState, ErrorState, Money, Skeleton } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useCompleteDemoPayment, useDemoPayment, type DemoOutcome } from '@/lib/api/checkout';
import { isApiError } from '@/lib/api/errors';
import { loginUrl } from '@/lib/nav';

/**
 * Sandbox payment screen for the built-in `demo` provider. It is deliberately loud about being fake: the three
 * buttons post a simulated outcome to the backend, which settles the payment exactly once.
 */
export default function DemoPaymentPage() {
  useSeo({ title: 'Sandbox payment', noindex: true });
  const { reference = '' } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const payment = useDemoPayment(reference);
  const complete = useCompleteDemoPayment(reference);
  const [chosen, setChosen] = useState<DemoOutcome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = (outcome: DemoOutcome) => {
    setChosen(outcome);
    setProblem(null);
    complete.mutate(outcome, {
      onSuccess: (result) => {
        const n = encodeURIComponent(result.order_number);
        if (outcome === 'success')
          navigate(`/orders/${n}/confirmation?payment=return`, { replace: true });
        else
          navigate(`/orders/${n}?payment=${outcome === 'decline' ? 'failed' : 'cancelled'}`, {
            replace: true,
          });
      },
      onError: (error) =>
        setProblem(
          error instanceof Error ? error.message : 'We could not record that. Please try again.',
        ),
    });
  };

  const error = payment.error;
  const unauthorised = isApiError(error) && error.status === 401;
  const notFound = isApiError(error) && (error.status === 404 || error.status === 403);

  return (
    <Container size="narrow" className="py-10 md:py-16">
      {payment.isPending || authLoading ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      ) : unauthorised || (!isAuthenticated && payment.isError) ? (
        <EmptyState
          as="h1"
          icon={<LogIn aria-hidden="true" />}
          title="Sign in to continue"
          description="This sandbox payment belongs to your account."
          action={
            <Button asChild>
              <Link to={loginUrl(`/pay/demo/${reference}`)}>Sign in</Link>
            </Button>
          }
        />
      ) : notFound ? (
        <EmptyState
          as="h1"
          icon={<Ban aria-hidden="true" />}
          title="This payment session was not found"
          description="The link may have expired, or sandbox payments are switched off. Your order is safe: open your orders to try paying again."
          action={
            <Button asChild>
              <Link to="/account/orders">View your orders</Link>
            </Button>
          }
        />
      ) : payment.isError ? (
        <ErrorState
          error={error}
          onRetry={() => void payment.refetch()}
          retrying={payment.isFetching}
        />
      ) : (
        <article
          aria-labelledby="demo-title"
          className="overflow-hidden rounded-lg border-2 border-dashed border-info bg-surface-raised"
        >
          <div
            role="note"
            className="flex items-center gap-3 bg-info-bg px-5 py-3.5 text-info sm:px-7"
          >
            <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
            <p className="text-sm font-semibold">Sandbox payment — no real money moves</p>
          </div>
          <div className="grid gap-6 p-5 sm:p-7">
            <header>
              <p className="eyebrow text-text-muted">Lantern sandbox checkout</p>
              <h1 id="demo-title" className="mt-1 text-h3">
                Pay for order {payment.data.order_number}
              </h1>
              <p className="mt-2 text-[0.9375rem] text-text-muted">
                {payment.data.notice} Choose what should happen; the order updates just as it would
                with a real card.
              </p>
            </header>

            <ul
              className="divide-y divide-border rounded-md border border-border"
              aria-label="Order items"
            >
              {payment.data.items.map((item, i) => (
                <li
                  key={`${item.name}-${i}`}
                  className="flex justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span>
                    {item.quantity} × {item.name}
                  </span>
                  <Money value={item.line_total} />
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 bg-surface-sunken px-4 py-3">
                <span className="font-semibold">Total (incl. tax and fees)</span>
                <Money value={payment.data.total} className="font-display text-xl font-semibold" />
              </li>
            </ul>

            {problem && payment.data.can_complete ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-bg p-3.5 text-sm font-medium text-danger"
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <div className="grid gap-2">
                  <p>{problem}</p>
                  <Link
                    to={`/orders/${encodeURIComponent(payment.data.order_number)}`}
                    className="w-fit underline underline-offset-4"
                  >
                    Go to your order
                  </Link>
                </div>
              </div>
            ) : null}

            {payment.data.can_complete ? (
              <div className="grid gap-3">
                <Button
                  size="lg"
                  block
                  leadingIcon={<CircleCheckBig aria-hidden="true" className="size-5" />}
                  loading={complete.isPending && chosen === 'success'}
                  loadingText="Confirming…"
                  disabled={complete.isPending && chosen !== 'success'}
                  onClick={() => run('success')}
                >
                  Simulate successful payment
                </Button>
                <Button
                  size="lg"
                  block
                  variant="secondary"
                  leadingIcon={<CreditCard aria-hidden="true" className="size-5" />}
                  loading={complete.isPending && chosen === 'decline'}
                  loadingText="Declining…"
                  disabled={complete.isPending && chosen !== 'decline'}
                  onClick={() => run('decline')}
                >
                  Simulate card declined
                </Button>
                <Button
                  variant="ghost"
                  block
                  leadingIcon={<Ban aria-hidden="true" className="size-4" />}
                  loading={complete.isPending && chosen === 'cancel'}
                  loadingText="Cancelling…"
                  disabled={complete.isPending && chosen !== 'cancel'}
                  onClick={() => run('cancel')}
                >
                  Cancel payment
                </Button>
              </div>
            ) : (
              <div
                role="status"
                className="grid gap-3 rounded-md bg-surface-sunken p-4 text-[0.9375rem]"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">
                    This sandbox payment is already{' '}
                    {payment.data.status.toLowerCase().replace(/_/g, ' ')}
                  </Badge>
                </p>
                <p className="text-text-muted">
                  It cannot be used again, so nothing can be charged twice.
                </p>
                <div>
                  <Button asChild>
                    <Link to={`/orders/${encodeURIComponent(payment.data.order_number)}`}>
                      Go to your order
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </article>
      )}
    </Container>
  );
}
