import { Link, useNavigate, useSearchParams } from 'react-router';
import { Bike, Package, RotateCcw, Store } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Money,
  Pagination,
  Skeleton,
  StatusBadge,
  toast,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { describeError } from '@/lib/api/errors';
import { useOrders, useReorder, type OrderSummary } from '@/lib/api/orders';
import { cn } from '@/lib/cn';
import { formatDate } from '@/features/orders/format';
import { PaymentBadges } from '@/features/orders/components/OrderParts';
import { AccountShell } from '../components/AccountShell';

const PAGE_SIZE = 10;

const FILTERS = [
  { key: 'all', label: 'All', statuses: undefined },
  {
    key: 'active',
    label: 'In progress',
    statuses: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'],
  },
  { key: 'completed', label: 'Completed', statuses: ['COMPLETED'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['CANCELLED'] },
] as const;

function OrderCard({ order }: { order: OrderSummary }) {
  const reorder = useReorder();
  const navigate = useNavigate();
  const delivery = order.order_type === 'DELIVERY';
  const onReorder = () =>
    reorder.mutate(order.number, {
      onSuccess: (result) => {
        toast[result.skipped.length ? 'warning' : 'success'](
          result.skipped.length
            ? `Added to your cart. Skipped: ${result.skipped.map((s) => s.name).join(', ')}.`
            : 'Your items are back in the cart.',
        );
        navigate('/cart');
      },
      onError: (e) => toast.error(describeError(e).message),
    });
  return (
    <li
      className="grid gap-3 rounded-lg border border-border bg-surface-raised p-5 sm:grid-cols-[1fr_auto]"
      data-testid="order-card"
    >
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/orders/${encodeURIComponent(order.number)}`}
            className="rounded-xs font-display text-lg font-semibold underline-offset-4 hover:underline"
          >
            {order.number}
          </Link>
          <StatusBadge kind="order" status={order.status} />
          <PaymentBadges
            payment={{
              status: order.payment_status,
              provider: order.payment_method,
              provider_label: order.payment_method,
              is_sandbox: false,
              action: null,
              failure_message: null,
              can_retry: false,
            }}
            method={order.payment_method}
            status={order.payment_status}
          />
          {order.is_demo ? <Badge tone="outline">Demo</Badge> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
          <span>{formatDate(order.placed_at, order.branch.timezone)}</span>
          <span className="inline-flex items-center gap-1">
            {delivery ? (
              <Bike aria-hidden="true" className="size-3.5" />
            ) : (
              <Store aria-hidden="true" className="size-3.5" />
            )}
            {delivery ? 'Delivery' : 'Pickup'} · {order.branch.name}
          </span>
        </p>
        <p className="text-[0.9375rem]">
          {order.items_preview.slice(0, 3).join(', ')}
          {order.items_preview.length > 3 ? ` +${order.items_preview.length - 3} more` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end">
        <Money value={order.total} className="font-display text-xl font-semibold" />
        <div className="flex gap-2">
          <Button asChild size="sm" variant="secondary" className="max-sm:h-11">
            <Link
              to={`/orders/${encodeURIComponent(order.number)}`}
              aria-label={`View order ${order.number}`}
            >
              View
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="max-sm:h-11"
            onClick={onReorder}
            loading={reorder.isPending}
            aria-label={`Order ${order.number} again`}
            leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />}
          >
            Reorder
          </Button>
        </div>
      </div>
    </li>
  );
}

export default function OrdersPage() {
  useSeo({ title: 'Your orders', noindex: true });
  const [params, setParams] = useSearchParams();
  const filterKey = FILTERS.find((f) => f.key === params.get('status'))?.key ?? 'all';
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const page = Math.max(1, Number(params.get('page')) || 1);
  const orders = useOrders({ page, status: filter.statuses });

  const update = (next: { status?: string; page?: number }) => {
    const p = new URLSearchParams(params);
    if (next.status !== undefined) {
      if (next.status === 'all') p.delete('status');
      else p.set('status', next.status);
      p.delete('page');
    }
    if (next.page !== undefined) {
      if (next.page <= 1) p.delete('page');
      else p.set('page', String(next.page));
    }
    setParams(p, { replace: false });
  };

  const total = orders.data?.count ?? 0;
  return (
    <AccountShell title="Orders" description="Everything you have ordered, newest first.">
      <div role="group" aria-label="Filter orders by status" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={f.key === filterKey}
            onClick={() => update({ status: f.key })}
            className={cn(
              'inline-flex h-11 items-center rounded-pill border px-4 text-sm font-medium transition-colors',
              f.key === filterKey
                ? 'border-espresso bg-espresso text-cream'
                : 'border-border-strong bg-surface-raised hover:border-text',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {orders.isPending ? (
        <div className="grid gap-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : orders.isError ? (
        <ErrorState
          error={orders.error}
          onRetry={() => void orders.refetch()}
          retrying={orders.isFetching}
        />
      ) : orders.data.results.length === 0 ? (
        <EmptyState
          icon={<Package aria-hidden="true" />}
          title={filterKey === 'all' ? 'No orders yet' : 'No orders match this filter'}
          description={
            filterKey === 'all'
              ? 'When you order, it will show up here so you can track it and order it again.'
              : 'Try another filter to see more of your orders.'
          }
          action={
            filterKey === 'all' ? (
              <Button asChild>
                <Link to="/menu">Browse the menu</Link>
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => update({ status: 'all' })}>
                Show all orders
              </Button>
            )
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-text-muted" aria-live="polite">
            {total} {total === 1 ? 'order' : 'orders'}
          </p>
          <ul className="grid gap-4" aria-label="Your orders">
            {orders.data.results.map((o) => (
              <OrderCard key={o.number} order={o} />
            ))}
          </ul>
          <Pagination
            className="mt-8"
            page={page}
            pageCount={Math.ceil(total / PAGE_SIZE)}
            onPageChange={(p) => update({ page: p })}
          />
        </>
      )}
    </AccountShell>
  );
}
