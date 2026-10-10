import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Clock, Radio, RefreshCw, Sparkles } from 'lucide-react';
import {
  ACTIVE_ORDER_STATUSES,
  BOARD_REFRESH_MS,
  useAdminBoardOrders,
  useAdminQueue,
  type AdminOrderRow,
} from '@/lib/api/adminOrders';
import { Button, EmptyState, ErrorState, Money, Skeleton, Switch } from '@/design';
import { cn } from '@/lib/cn';
import { formatAge, formatTime } from '../../ops/format';
import { BranchSelect } from '../../ops/ReportFilterBar';
import { AttentionNote, OrderPaymentBadge, OrderTypeLabel, paymentMethodLabel } from './orderMeta';

interface BoardProps {
  branch: string;
  onBranch: (id: string) => void;
  stuckOnly: boolean;
  onStuckOnly: (v: boolean) => void;
  /** Reports how many unseen new orders there are (shown in the page title). */
  onNewCount?: (n: number) => void;
}

/**
 * Live queue: one column per active status with the count and the age of the oldest order (from `admin/orders/queue/`)
 * and the orders themselves (oldest first). Polls every 15 s while the tab is visible and the switch is on.
 * New orders get a "New" tag and a polite live-region announcement; there is no sound.
 */
export function OrderBoard({ branch, onBranch, stuckOnly, onStuckOnly, onNewCount }: BoardProps) {
  const [auto, setAuto] = useState(true);
  const interval = auto ? BOARD_REFRESH_MS : false;
  const branchId = branch || undefined;
  const orders = useAdminBoardOrders(branchId, stuckOnly, interval);
  const queue = useAdminQueue(branchId, interval);

  // Remember which order numbers were present on the first load; anything that appears later is "new".
  // (Derived while rendering from the latest data, so there is no effect-then-setState cascade.)
  const scope = `${branchId ?? 'all'}|${stuckOnly}`;
  const [seen, setSeen] = useState<{
    scope: string;
    data: unknown;
    known: Set<string> | null;
    fresh: Set<string>;
    announce: string;
  }>({ scope, data: undefined, known: null, fresh: new Set(), announce: '' });
  const rows = orders.data?.results;
  if (seen.scope !== scope) {
    // Changing the scope starts a fresh baseline (a different branch's orders are not "new").
    setSeen({ scope, data: undefined, known: null, fresh: new Set(), announce: '' });
  } else if (rows && orders.data !== seen.data) {
    const numbers = new Set(rows.map((r) => r.number));
    if (seen.known === null) {
      setSeen({ ...seen, data: orders.data, known: numbers });
    } else {
      const added = rows.filter((r) => !seen.known?.has(r.number) && r.status === 'PENDING');
      setSeen({
        ...seen,
        data: orders.data,
        known: new Set([...seen.known, ...numbers]),
        fresh: added.length ? new Set([...seen.fresh, ...added.map((r) => r.number)]) : seen.fresh,
        announce: added.length
          ? `${added.length} new order${added.length === 1 ? '' : 's'} received.`
          : seen.announce,
      });
    }
  }
  const fresh = seen.fresh;
  const announce = seen.announce;
  const clearFresh = () => setSeen((s) => ({ ...s, fresh: new Set() }));
  useEffect(() => onNewCount?.(fresh.size), [fresh, onNewCount]);

  const byStatus = new Map<string, AdminOrderRow[]>();
  for (const s of ACTIVE_ORDER_STATUSES) byStatus.set(s, []);
  for (const o of orders.data?.results ?? []) byStatus.get(o.status)?.push(o);

  const loading = orders.isPending || queue.isPending;
  const failed = (orders.isError && !orders.data) || (queue.isError && !queue.data);
  const updatedAt = queue.data?.generated_at ?? null;
  const totals = queue.data?.totals;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <BranchSelect value={branch} onChange={onBranch} />
        <Switch checked={stuckOnly} onCheckedChange={onStuckOnly} label="Needs attention only" />
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm text-text-muted">
          <span className="inline-flex items-center gap-1.5" aria-live="off">
            <Radio
              aria-hidden="true"
              className={cn('size-4', auto ? 'text-success' : 'text-text-muted')}
            />
            {auto ? `Live · refreshes every ${BOARD_REFRESH_MS / 1000} s` : 'Auto-refresh off'}
            {updatedAt ? ` · updated ${formatTime(updatedAt)}` : ''}
          </span>
          <Switch checked={auto} onCheckedChange={setAuto} label="Auto-refresh" />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void orders.refetch();
              void queue.refetch();
            }}
            loading={orders.isFetching || queue.isFetching}
            leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      <p role="status" className="sr-only">
        {announce}
      </p>
      {fresh.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent bg-accent-soft px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-2 font-medium">
            <Sparkles aria-hidden="true" className="size-4 text-accent-text" />
            {fresh.size} new order{fresh.size === 1 ? '' : 's'} since you opened this page
          </span>
          <Button size="sm" variant="ghost" onClick={clearFresh}>
            Mark as seen
          </Button>
        </div>
      ) : null}

      {failed ? (
        <ErrorState
          error={orders.error ?? queue.error}
          onRetry={() => {
            void orders.refetch();
            void queue.refetch();
          }}
        />
      ) : loading ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5" aria-busy="true">
          {ACTIVE_ORDER_STATUSES.map((s) => (
            <Skeleton key={s} className="h-64" />
          ))}
        </div>
      ) : totals?.active === 0 ? (
        <div className="rounded-lg border border-border bg-surface-raised">
          <EmptyState
            title={stuckOnly ? 'No orders need attention' : 'The queue is empty'}
            description={
              stuckOnly
                ? 'Nothing is waiting longer than it should.'
                : 'New orders appear here automatically.'
            }
          />
        </div>
      ) : (
        <div
          className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0"
          aria-label="Order queue"
          role="region"
        >
          {queue.data?.statuses.map((col) => {
            const cards = byStatus.get(col.status) ?? [];
            return (
              <section
                key={col.status}
                aria-labelledby={`col-${col.status}`}
                className="flex min-w-64 flex-1 snap-start flex-col rounded-lg border border-border bg-surface-sunken/60 lg:min-w-0"
              >
                <header className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id={`col-${col.status}`} className="font-sans text-sm font-semibold">
                      {col.label}
                    </h2>
                    <span
                      className="rounded-pill bg-espresso px-2 py-0.5 text-xs font-semibold text-cream tabular-nums"
                      aria-label={`${col.count} orders`}
                    >
                      {col.count}
                    </span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
                    <Clock aria-hidden="true" className="size-3" />
                    {col.count > 0
                      ? `Oldest ${formatAge(col.oldest_age_minutes)}`
                      : 'Nothing waiting'}
                    {col.stuck_count > 0 ? (
                      <span className="ml-auto font-semibold text-warning">
                        {col.stuck_count} late
                      </span>
                    ) : null}
                  </p>
                </header>
                <ul className="grid flex-1 content-start gap-2 p-2">
                  {cards.map((o) => (
                    <li key={o.number}>
                      <OrderCard order={o} isNew={fresh.has(o.number)} />
                    </li>
                  ))}
                  {col.count > cards.length ? (
                    <li className="px-1 py-2 text-xs text-text-muted">
                      +{col.count - cards.length} more in the table view.
                    </li>
                  ) : null}
                  {cards.length === 0 && col.count === 0 ? (
                    <li className="px-2 py-6 text-center text-xs text-text-muted">Empty</li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order: o, isNew }: { order: AdminOrderRow; isNew: boolean }) {
  return (
    <Link
      to={`/admin/orders/${encodeURIComponent(o.number)}`}
      className={cn(
        'block rounded-md border bg-surface-raised p-2.5 text-sm shadow-xs transition-colors hover:border-border-strong',
        o.is_stuck ? 'border-warning' : 'border-border',
        isNew && 'ring-2 ring-accent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{o.number}</span>
        <span
          className="text-xs text-text-muted tabular-nums"
          title={`Placed ${formatTime(o.placed_at)}`}
        >
          {formatAge(o.age_minutes)}
        </span>
      </div>
      {isNew ? (
        <span className="mt-1 inline-block rounded-xs bg-accent px-1.5 py-0.5 text-[0.6875rem] font-semibold text-accent-foreground">
          New
        </span>
      ) : null}
      <p className="mt-1 truncate">{o.customer_name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
        <OrderTypeLabel type={o.order_type} />
        <span>
          {o.item_count} item{o.item_count === 1 ? '' : 's'}
        </span>
        <span className="tabular-nums">
          <Money value={o.total} />
        </span>
      </p>
      <p className="mt-0.5 text-xs text-text-muted">{o.branch.name}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <OrderPaymentBadge status={o.payment_status} method={o.payment_method} />
        <span className="text-xs text-text-muted">{paymentMethodLabel(o.payment_method)}</span>
      </div>
      {o.needs_attention ? (
        <p className="mt-2">
          <AttentionNote message={o.needs_attention.message} />
        </p>
      ) : null}
    </Link>
  );
}
