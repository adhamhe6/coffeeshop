import { useMemo } from 'react';
import { Link } from 'react-router';
import { FlaskConical } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Badge, ErrorState, Money, Pagination, Select, StatusBadge } from '@/design';
import {
  useReport,
  type Granularity,
  type ReportKind,
  type ReportParams,
} from '@/lib/api/adminReports';
import { BarList } from '../../ops/BarList';
import { formatInt, formatPct, humanise, formatShortDateTime } from '../../ops/format';
import { Panel } from '../../ops/PageHeader';
import { TimeSeriesChart, bucketLabel } from '../../ops/TimeSeriesChart';
import { useCompactMoney } from '../../overview/components/SalesPanel';
import { ReportTable, SummaryStrip, type ReportColumn } from './ReportTable';

const PAGE_SIZE = 20;

export interface PanelProps {
  params: ReportParams;
  /** Report-specific URL state. */
  page: number;
  onPage: (p: number) => void;
  ordering?: string;
  onOrdering: (o: string | null) => void;
  status?: string;
  onStatus: (s: string | null) => void;
}

const m = (v: string | number | null | undefined) => <Money value={v} />;
const int = (v: number | null | undefined) => formatInt(v);

/** Shared loading / error wrapper for a report query. */
function useReportView<K extends ReportKind>(kind: K, params: ReportParams) {
  const q = useReport(kind, params);
  const error =
    q.isError && !q.data ? (
      <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
    ) : null;
  return { q, data: q.data, loading: q.isPending, error };
}

function PageNav({
  count,
  page,
  onPage,
}: {
  count: number;
  page: number;
  onPage: (p: number) => void;
}) {
  return (
    <Pagination
      page={page}
      pageCount={Math.max(1, Math.ceil(count / PAGE_SIZE))}
      onPageChange={onPage}
    />
  );
}

function toggleSort(
  current: string | undefined,
  key: string,
  onOrdering: (o: string | null) => void,
  first: 'asc' | 'desc' = 'desc',
) {
  const active = current?.replace(/^-/, '') === key;
  if (!active) return onOrdering(first === 'desc' ? `-${key}` : key);
  onOrdering(current?.startsWith('-') ? key : `-${key}`);
}
const sortState = (ordering: string | undefined) =>
  ordering
    ? {
        key: ordering.replace(/^-/, ''),
        direction: ordering.startsWith('-') ? ('desc' as const) : ('asc' as const),
      }
    : null;

// ── Sales ───────────────────────────────────────────────────────────────────────────────────────────────
export function SalesReportPanel({ params }: PanelProps) {
  const { data, loading, error } = useReportView('sales', params);
  const money = useCompactMoney();
  const gran = (params.granularity ?? 'day') as Granularity;
  const net = useMemo(
    () => (data?.results ?? []).map((r) => ({ bucket: r.bucket, value: Number(r.net_sales) })),
    [data],
  );
  const orders = useMemo(
    () => (data?.results ?? []).map((r) => ({ bucket: r.bucket, value: r.orders })),
    [data],
  );
  if (error) return error;
  const t = data?.totals;
  const cols: ReportColumn<NonNullable<typeof data>['results'][number]>[] = [
    {
      id: 'bucket',
      header: gran === 'day' ? 'Day' : gran === 'week' ? 'Week' : 'Month',
      cell: (r) => bucketLabel(r.bucket, gran, true),
      total: 'Total',
    },
    {
      id: 'orders',
      header: 'Orders',
      align: 'right',
      cell: (r) => int(r.orders),
      total: t ? int(t.orders) : undefined,
    },
    {
      id: 'gross',
      header: 'Gross sales',
      align: 'right',
      cell: (r) => m(r.gross_sales),
      total: t ? m(t.gross_sales) : undefined,
    },
    {
      id: 'disc',
      header: 'Discounts',
      align: 'right',
      cell: (r) => m(r.discounts),
      total: t ? m(t.discounts) : undefined,
    },
    {
      id: 'del',
      header: 'Delivery fees',
      align: 'right',
      cell: (r) => m(r.delivery_fees),
      total: t ? m(t.delivery_fees) : undefined,
    },
    {
      id: 'tax',
      header: 'Tax',
      align: 'right',
      cell: (r) => m(r.tax),
      total: t ? m(t.tax) : undefined,
    },
    {
      id: 'ref',
      header: 'Refunds',
      align: 'right',
      cell: (r) => m(r.refunds),
      total: t ? m(t.refunds) : undefined,
    },
    {
      id: 'net',
      header: 'Net sales',
      align: 'right',
      cell: (r) => m(r.net_sales),
      total: t ? m(t.net_sales) : undefined,
    },
    {
      id: 'col',
      header: 'Revenue collected',
      align: 'right',
      cell: (r) => m(r.revenue_collected),
      total: t ? m(t.revenue_collected) : undefined,
    },
    {
      id: 'aov',
      header: 'Avg order',
      align: 'right',
      cell: (r) => m(r.average_order_value),
      total: t ? m(t.average_order_value) : undefined,
    },
  ];
  return (
    <div className="grid gap-4">
      <Panel title="Trend" description="Counted orders only">
        <div className="grid gap-6 xl:grid-cols-2 print:hidden">
          <TimeSeriesChart
            title="Net sales"
            measure="Net sales"
            kind="area"
            data={net}
            granularity={gran}
            formatValue={money.full}
            formatTick={money.tick}
            loading={loading}
          />
          <TimeSeriesChart
            title="Orders counted as sales"
            measure="Orders"
            kind="bar"
            data={orders}
            granularity={gran}
            formatValue={formatInt}
            formatTick={formatInt}
            loading={loading}
          />
        </div>
      </Panel>
      <ReportTable
        caption="Sales by period"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => r.bucket}
        emptyTitle="No sales in this period"
      />
    </div>
  );
}

// ── Orders by status ────────────────────────────────────────────────────────────────────────────────────
export function StatusReportPanel({ params }: PanelProps) {
  const { data, loading, error } = useReportView('orders-by-status', params);
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const cols: ReportColumn<Row>[] = [
    {
      id: 'label',
      header: 'Status',
      cell: (r) => <StatusBadge kind="order" status={r.status} />,
      total: 'All orders placed',
    },
    {
      id: 'count',
      header: 'Orders',
      align: 'right',
      cell: (r) => int(r.count),
      total: t ? int(t.orders_total) : undefined,
    },
    {
      id: 'share',
      header: 'Share',
      align: 'right',
      cell: (r) => formatPct(r.share),
      total: t ? formatPct(t.orders_total ? 100 : 0) : undefined,
    },
  ];
  return (
    <div className="grid gap-4">
      {t ? (
        <SummaryStrip
          items={[
            { label: 'Orders placed', value: int(t.orders_total) },
            { label: 'Counted as sales', value: int(t.orders_counted) },
            { label: 'Completed', value: int(t.orders_completed) },
            { label: 'In progress', value: int(t.orders_pending) },
            { label: 'Cancelled', value: int(t.orders_cancelled) },
          ]}
        />
      ) : null}
      <ReportTable
        caption="Orders by status"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => r.status}
      />
    </div>
  );
}

// ── Products ────────────────────────────────────────────────────────────────────────────────────────────
export function ProductsReportPanel({ params, page, onPage, ordering, onOrdering }: PanelProps) {
  const { data, loading, error } = useReportView('products', { ...params, page, ordering });
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const cols: ReportColumn<Row>[] = [
    {
      id: 'product',
      header: 'Product',
      sortKey: 'name',
      cell: (r) => (
        <span>
          {r.product_name}
          <span className="block text-xs font-normal text-text-muted">{r.sku}</span>
        </span>
      ),
      total: 'Total (all products)',
    },
    { id: 'category', header: 'Category', cell: (r) => r.category_name || '—' },
    {
      id: 'units',
      header: 'Units',
      align: 'right',
      sortKey: 'units',
      cell: (r) => int(r.units),
      total: t ? int(t.units) : undefined,
    },
    {
      id: 'orders',
      header: 'Orders',
      align: 'right',
      sortKey: 'orders',
      cell: (r) => int(r.orders),
      total: t ? int(t.orders) : undefined,
    },
    {
      id: 'gross',
      header: 'Gross',
      align: 'right',
      sortKey: 'gross',
      cell: (r) => m(r.gross),
      total: t ? m(t.gross) : undefined,
    },
    {
      id: 'disc',
      header: 'Discounts',
      align: 'right',
      cell: (r) => m(r.discounts),
      total: t ? m(t.discounts) : undefined,
    },
    {
      id: 'net',
      header: 'Net',
      align: 'right',
      sortKey: 'net',
      cell: (r) => m(r.net),
      total: t ? m(t.net) : undefined,
    },
    { id: 'share', header: 'Share', align: 'right', cell: (r) => formatPct(r.share) },
  ];
  return (
    <div className="grid gap-3">
      <ReportTable
        caption="Product sales"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => r.sku}
        sort={sortState(ordering ?? '-net')}
        onSort={(k) => toggleSort(ordering ?? '-net', k, onOrdering, k === 'name' ? 'asc' : 'desc')}
        emptyTitle="No product sales in this period"
      />
      {data ? <PageNav count={data.count} page={page} onPage={onPage} /> : null}
    </div>
  );
}

// ── Categories ──────────────────────────────────────────────────────────────────────────────────────────
export function CategoriesReportPanel({ params }: PanelProps) {
  const { data, loading, error } = useReportView('categories', params);
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const cols: ReportColumn<Row>[] = [
    { id: 'category', header: 'Category', cell: (r) => r.category, total: 'Total' },
    {
      id: 'units',
      header: 'Units',
      align: 'right',
      cell: (r) => int(r.units),
      total: t ? int(t.units) : undefined,
    },
    {
      id: 'orders',
      header: 'Orders',
      align: 'right',
      cell: (r) => int(r.orders),
      total: t ? int(t.orders) : undefined,
    },
    {
      id: 'gross',
      header: 'Gross',
      align: 'right',
      cell: (r) => m(r.gross),
      total: t ? m(t.gross) : undefined,
    },
    {
      id: 'disc',
      header: 'Discounts',
      align: 'right',
      cell: (r) => m(r.discounts),
      total: t ? m(t.discounts) : undefined,
    },
    {
      id: 'net',
      header: 'Net',
      align: 'right',
      cell: (r) => m(r.net),
      total: t ? m(t.net) : undefined,
    },
    { id: 'share', header: 'Share', align: 'right', cell: (r) => formatPct(r.share) },
  ];
  return (
    <div className="grid gap-4">
      {data && data.results.length > 0 ? (
        <Panel title="Net sales by category" className="print:hidden">
          <BarList
            label="Net sales by category"
            items={data.results.map((r) => ({
              key: r.category,
              label: r.category,
              value: Number(r.net),
              display: m(r.net),
              hint: `${formatPct(r.share)} of net`,
            }))}
          />
        </Panel>
      ) : null}
      <ReportTable
        caption="Category sales"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => r.category}
      />
    </div>
  );
}

// ── Branches ────────────────────────────────────────────────────────────────────────────────────────────
export function BranchesReportPanel({ params }: PanelProps) {
  const { data, loading, error } = useReportView('branches', params);
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const cols: ReportColumn<Row>[] = [
    { id: 'branch', header: 'Branch', cell: (r) => r.branch, total: 'Total' },
    {
      id: 'placed',
      header: 'Orders placed',
      align: 'right',
      cell: (r) => int(r.orders_total),
      total: t ? int(t.orders_total) : undefined,
    },
    {
      id: 'orders',
      header: 'Counted',
      align: 'right',
      cell: (r) => int(r.orders),
      total: t ? int(t.orders) : undefined,
    },
    {
      id: 'gross',
      header: 'Gross sales',
      align: 'right',
      cell: (r) => m(r.gross_sales),
      total: t ? m(t.gross_sales) : undefined,
    },
    {
      id: 'disc',
      header: 'Discounts',
      align: 'right',
      cell: (r) => m(r.discounts),
      total: t ? m(t.discounts) : undefined,
    },
    {
      id: 'ref',
      header: 'Refunds',
      align: 'right',
      cell: (r) => m(r.refunds),
      total: t ? m(t.refunds) : undefined,
    },
    {
      id: 'net',
      header: 'Net sales',
      align: 'right',
      cell: (r) => m(r.net_sales),
      total: t ? m(t.net_sales) : undefined,
    },
    {
      id: 'col',
      header: 'Collected',
      align: 'right',
      cell: (r) => m(r.revenue_collected),
      total: t ? m(t.revenue_collected) : undefined,
    },
    {
      id: 'aov',
      header: 'Avg order',
      align: 'right',
      cell: (r) => m(r.average_order_value),
      total: t ? m(t.average_order_value) : undefined,
    },
  ];
  return (
    <ReportTable
      caption="Sales by branch"
      columns={cols}
      rows={data?.results}
      loading={loading}
      getRowId={(r) => r.branch_id}
    />
  );
}

// ── Promotions ──────────────────────────────────────────────────────────────────────────────────────────
export function PromotionsReportPanel({ params, page, onPage }: PanelProps) {
  const { data, loading, error } = useReportView('promotions', { ...params, page });
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const cols: ReportColumn<Row>[] = [
    {
      id: 'code',
      header: 'Promotion',
      cell: (r) => (
        <span>
          {r.code || r.name}
          <span className="block text-xs font-normal text-text-muted">
            {r.name}
            {r.is_automatic ? ' · automatic' : ''}
            {r.is_active ? '' : ' · inactive'}
          </span>
        </span>
      ),
      total: 'Total',
    },
    {
      id: 'type',
      header: 'Discount',
      cell: (r) =>
        r.discount_type === 'PERCENT' ? `${Number(r.value)}%` : <Money value={r.value} />,
    },
    {
      id: 'red',
      header: 'Redemptions',
      align: 'right',
      cell: (r) => int(r.redemptions),
      total: t ? int(t.redemptions) : undefined,
    },
    {
      id: 'given',
      header: 'Discount given',
      align: 'right',
      cell: (r) => m(r.discount_given),
      total: t ? m(t.discount_given) : undefined,
    },
    {
      id: 'orders',
      header: 'Counted orders',
      align: 'right',
      cell: (r) => int(r.orders),
      total: t ? int(t.orders) : undefined,
    },
    {
      id: 'rev',
      header: 'Revenue influenced',
      align: 'right',
      cell: (r) => m(r.revenue_influenced),
      total: t ? m(t.revenue_influenced) : undefined,
    },
  ];
  return (
    <div className="grid gap-3">
      {t ? (
        <p className="text-sm text-text-muted">
          All discounts on counted orders in the period: <Money value={t.discounts} /> across{' '}
          {int(t.orders_counted)} orders. This equals the Discounts figure on the Overview.
        </p>
      ) : null}
      <ReportTable
        caption="Promotion performance"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => r.coupon_id}
        emptyTitle="No promotions were used"
      />
      {data ? <PageNav count={data.count} page={page} onPage={onPage} /> : null}
    </div>
  );
}

// ── Payments ────────────────────────────────────────────────────────────────────────────────────────────
export function PaymentsReportPanel({ params }: PanelProps) {
  const { data, loading, error } = useReportView('payments', params);
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const cols: ReportColumn<Row>[] = [
    {
      id: 'provider',
      header: 'Provider',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {humanise(r.provider)}
          {r.is_sandbox ? (
            <Badge tone="outline">
              <FlaskConical aria-hidden="true" />
              Sandbox
            </Badge>
          ) : null}
        </span>
      ),
      total: 'Total',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge kind="payment" status={r.status} />,
    },
    {
      id: 'count',
      header: 'Attempts',
      align: 'right',
      cell: (r) => int(r.count),
      total: t ? int(t.payments) : undefined,
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => m(r.amount),
      total: t ? m(t.amount) : undefined,
    },
    {
      id: 'refunded',
      header: 'Refunded',
      align: 'right',
      cell: (r) => m(r.refunded),
      total: t ? m(t.refunded_amount) : undefined,
    },
  ];
  return (
    <div className="grid gap-4">
      {t?.includes_sandbox ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-border-strong bg-accent-soft px-3 py-2 text-sm"
        >
          <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
          <span>
            Includes {int(t.sandbox_payments)} sandbox payment{t.sandbox_payments === 1 ? '' : 's'}.
            No real money moved for those.
          </span>
        </p>
      ) : null}
      {t ? (
        <SummaryStrip
          items={[
            { label: 'Payment attempts', value: int(t.payments) },
            {
              label: 'Settled',
              value: m(t.settled_amount),
              hint: `${int(t.settled_payments)} payments`,
            },
            { label: 'Refunded', value: m(t.refunded_amount) },
            { label: 'Collected', value: m(t.collected_amount), hint: 'Settled minus refunded' },
            {
              label: 'Failures',
              value: int(t.payment_failures),
              hint: `${formatPct(t.failure_rate)} of attempts`,
            },
          ]}
        />
      ) : null}
      <ReportTable
        caption="Payments by provider and status"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => `${r.provider}-${r.status}-${r.is_sandbox}`}
        showTotals
      />
      {data && data.failures.length > 0 ? (
        <Panel title="Top failure reasons" bodyClassName="p-0">
          <ReportTable
            caption="Failure reasons"
            showTotals={false}
            columns={[
              {
                id: 'provider',
                header: 'Provider',
                cell: (r: (typeof data.failures)[number]) => humanise(r.provider),
              },
              { id: 'code', header: 'Reason code', cell: (r) => r.failure_code || 'unknown' },
              { id: 'count', header: 'Failures', align: 'right', cell: (r) => int(r.count) },
              { id: 'amount', header: 'Amount', align: 'right', cell: (r) => m(r.amount) },
            ]}
            rows={data.failures}
            getRowId={(_, i) => i}
          />
        </Panel>
      ) : null}
    </div>
  );
}

// ── Refunds ─────────────────────────────────────────────────────────────────────────────────────────────
export function RefundsReportPanel({ params, page, onPage }: PanelProps) {
  const auth = useAuth();
  const { data, loading, error } = useReportView('refunds', { ...params, page });
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const canOrders = auth.hasCapability('orders.view');
  const orderLink = (n: string) =>
    canOrders ? (
      <Link
        to={`/admin/orders/${encodeURIComponent(n)}`}
        className="underline-offset-4 hover:underline"
      >
        {n}
      </Link>
    ) : (
      n
    );
  const cols: ReportColumn<Row>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: (r) => orderLink(r.order_number),
      total: 'Succeeded (all orders)',
    },
    { id: 'when', header: 'Created', cell: (r) => formatShortDateTime(r.created_at) },
    {
      id: 'provider',
      header: 'Provider',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {humanise(r.provider)}
          {r.is_sandbox ? <Badge tone="outline">Sandbox</Badge> : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Refund',
      cell: (r) => (
        <Badge
          tone={
            r.status === 'SUCCEEDED' ? 'success' : r.status === 'PENDING' ? 'warning' : 'danger'
          }
        >
          {humanise(r.status)}
        </Badge>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => m(r.amount),
      total: t ? m(t.refunded_amount) : undefined,
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (r) => r.reason || '—',
      className: 'max-w-64 truncate',
    },
    {
      id: 'counted',
      header: 'In sales',
      cell: (r) => (r.counted_in_sales ? 'Yes' : 'No (cancelled order)'),
    },
  ];
  return (
    <div className="grid gap-4">
      {t ? (
        <SummaryStrip
          items={[
            {
              label: 'Refunds in sales',
              value: m(t.refunds),
              hint: 'Counted orders (matches Overview)',
            },
            { label: 'Refunded (succeeded)', value: m(t.refunded_amount) },
            { label: 'Pending with provider', value: m(t.pending_amount) },
            { label: 'Failed refunds', value: int(t.failed_refunds) },
            {
              label: 'Cancelled orders',
              value: int(t.cancelled_orders),
              hint: <Money value={t.cancelled_value} />,
            },
            {
              label: 'Paid, cancelled, not refunded',
              value: int(t.cancelled_paid_unrefunded),
              hint: (
                <>
                  <Money value={t.cancelled_unrefunded_amount} /> to return
                </>
              ),
            },
            { label: 'Refund needed now', value: int(t.refund_needed_orders), hint: 'All time' },
          ]}
        />
      ) : null}
      <ReportTable
        caption="Refunds"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => r.id}
        emptyTitle="No refunds in this period"
      />
      {data ? <PageNav count={data.count} page={page} onPage={onPage} /> : null}
      {data && data.cancellations.length > 0 ? (
        <Panel title="Cancelled orders" description="Latest 100 in the period" bodyClassName="p-0">
          <ReportTable
            caption="Cancelled orders"
            showTotals={false}
            columns={[
              {
                id: 'n',
                header: 'Order',
                cell: (r: (typeof data.cancellations)[number]) => orderLink(r.number),
              },
              { id: 'when', header: 'Cancelled', cell: (r) => formatShortDateTime(r.cancelled_at) },
              { id: 'reason', header: 'Reason', cell: (r) => r.cancel_reason || '—' },
              {
                id: 'pay',
                header: 'Payment',
                cell: (r) => <StatusBadge kind="payment" status={r.payment_status} />,
              },
              { id: 'total', header: 'Total', align: 'right', cell: (r) => m(r.total) },
              { id: 'back', header: 'Refunded', align: 'right', cell: (r) => m(r.refunded_total) },
              {
                id: 'need',
                header: 'To refund',
                align: 'right',
                cell: (r) =>
                  r.refund_needed ? (
                    <strong>
                      <Money value={r.amount_to_refund} />
                    </strong>
                  ) : (
                    '—'
                  ),
              },
            ]}
            rows={data.cancellations}
            getRowId={(r) => r.number}
          />
        </Panel>
      ) : null}
    </div>
  );
}

// ── Inventory ───────────────────────────────────────────────────────────────────────────────────────────
const INVENTORY_STATUS: Record<string, { label: string; tone: 'danger' | 'warning' | 'success' }> =
  {
    out: { label: 'Out of stock', tone: 'danger' },
    low: { label: 'Low', tone: 'warning' },
    ok: { label: 'In stock', tone: 'success' },
  };

export function InventoryReportPanel({
  params,
  page,
  onPage,
  ordering,
  onOrdering,
  status,
  onStatus,
}: PanelProps) {
  const { data, loading, error } = useReportView('inventory', {
    ...params,
    page,
    ordering,
    status,
  });
  if (error) return error;
  const t = data?.totals;
  type Row = NonNullable<typeof data>['results'][number];
  const cols: ReportColumn<Row>[] = [
    {
      id: 'product',
      header: 'Product',
      sortKey: 'product',
      cell: (r) => (
        <span>
          {r.product_name}
          <span className="block text-xs font-normal text-text-muted">
            {r.sku}
            {r.is_active ? '' : ' · unpublished'}
          </span>
        </span>
      ),
      total: 'Total',
    },
    { id: 'branch', header: 'Branch', sortKey: 'branch', cell: (r) => r.branch_name },
    {
      id: 'qty',
      header: 'On hand',
      align: 'right',
      sortKey: 'quantity',
      cell: (r) => int(r.quantity),
      total: t ? int(t.units_on_hand) : undefined,
    },
    { id: 'thr', header: 'Low at', align: 'right', cell: (r) => int(r.low_stock_threshold) },
    {
      id: 'cost',
      header: 'Unit cost',
      align: 'right',
      cell: (r) => (r.unit_cost === null ? '—' : m(r.unit_cost)),
    },
    {
      id: 'val',
      header: 'Value',
      align: 'right',
      sortKey: 'value',
      cell: (r) => (r.value === null ? '—' : m(r.value)),
      total: t ? m(t.stock_value) : undefined,
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (r) => {
        const s = INVENTORY_STATUS[r.status];
        return <Badge tone={s?.tone ?? 'neutral'}>{s?.label ?? r.status}</Badge>;
      },
    },
  ];
  return (
    <div className="grid gap-4">
      {t ? (
        <SummaryStrip
          items={[
            { label: 'Stock rows', value: int(t.stock_items) },
            { label: 'Units on hand', value: int(t.units_on_hand) },
            {
              label: 'Stock value',
              value: m(t.stock_value),
              hint: t.items_without_cost
                ? `${int(t.items_without_cost)} rows have no cost`
                : undefined,
            },
            { label: 'Low stock', value: int(t.low_stock_products), hint: 'products' },
            { label: 'Out of stock', value: int(t.out_of_stock_products), hint: 'products' },
          ]}
        />
      ) : null}
      <div className="flex items-center gap-2 print:hidden">
        <span className="text-sm text-text-muted">Show</span>
        <Select
          size="sm"
          aria-label="Stock status"
          value={status ?? 'all'}
          onValueChange={(v) => onStatus(v === 'all' ? null : v)}
          options={[
            { value: 'all', label: 'All rows' },
            { value: 'out', label: 'Out of stock' },
            { value: 'low', label: 'Low stock' },
            { value: 'ok', label: 'In stock' },
          ]}
          className="min-w-40 max-md:h-11"
        />
      </div>
      <ReportTable
        caption="Stock levels"
        columns={cols}
        rows={data?.results}
        loading={loading}
        getRowId={(r) => r.id}
        sort={sortState(ordering ?? 'status')}
        onSort={(k) => toggleSort(ordering ?? 'status', k, onOrdering, 'asc')}
        emptyTitle="No stock rows match"
        showTotals={!status}
      />
      {data ? <PageNav count={data.count} page={page} onPage={onPage} /> : null}
      {data && data.movements.length > 0 ? (
        <Panel title="Stock movements in this period" bodyClassName="p-0">
          <ReportTable
            caption="Stock movements by type"
            showTotals={false}
            columns={[
              { id: 'type', header: 'Type', cell: (r: (typeof data.movements)[number]) => r.label },
              { id: 'n', header: 'Movements', align: 'right', cell: (r) => int(r.movements) },
              { id: 'in', header: 'Units in', align: 'right', cell: (r) => int(r.units_in) },
              { id: 'out', header: 'Units out', align: 'right', cell: (r) => int(r.units_out) },
              { id: 'net', header: 'Net', align: 'right', cell: (r) => int(r.net_units) },
            ]}
            rows={data.movements}
            getRowId={(r) => r.movement_type}
          />
        </Panel>
      ) : null}
    </div>
  );
}

// ── Customers ───────────────────────────────────────────────────────────────────────────────────────────
export function CustomersReportPanel({ params }: PanelProps) {
  const { data, loading, error } = useReportView('customers', params);
  if (error) return error;
  const t = data?.totals;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-text-muted">
        Names are shortened and contact details are masked in reports.
      </p>
      {t ? (
        <SummaryStrip
          items={[
            { label: 'Customers', value: int(t.customers), hint: 'With a counted order' },
            { label: 'New', value: int(t.new_customers) },
            { label: 'Returning', value: int(t.returning_customers) },
            { label: 'Orders per customer', value: t.orders_per_customer.toFixed(2) },
            { label: 'Revenue collected', value: m(t.revenue_collected) },
          ]}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Order frequency" description="Counted orders per customer in the period">
          {data ? (
            <BarList
              label="Customers by order frequency"
              items={data.results.map((r) => ({
                key: r.bucket,
                label: `${r.label}`,
                value: r.customers,
                display: `${int(r.customers)} · ${formatPct(r.share)}`,
              }))}
            />
          ) : null}
        </Panel>
        <Panel title="New vs returning">
          {data ? (
            <BarList
              label="New and returning customers"
              items={data.new_vs_returning.map((r) => ({
                key: r.segment,
                label: r.label,
                value: r.customers,
                display: `${int(r.customers)} · ${formatPct(r.share)}`,
              }))}
            />
          ) : null}
        </Panel>
      </div>
      <Panel title="Top customers by spend" bodyClassName="p-0">
        <ReportTable
          caption="Top customers"
          showTotals={false}
          loading={loading}
          columns={[
            {
              id: 'name',
              header: 'Customer',
              cell: (r: NonNullable<typeof data>['top_customers'][number]) => (
                <span>
                  {r.name}
                  <span className="block text-xs font-normal text-text-muted">
                    {r.email}
                    {r.phone ? ` · ${r.phone}` : ''}
                  </span>
                </span>
              ),
            },
            { id: 'orders', header: 'Orders', align: 'right', cell: (r) => int(r.orders) },
            { id: 'spend', header: 'Spend', align: 'right', cell: (r) => m(r.spend) },
            { id: 'last', header: 'Last order', cell: (r) => formatShortDateTime(r.last_order_at) },
          ]}
          rows={data?.top_customers}
          getRowId={(r) => r.customer_id}
        />
      </Panel>
    </div>
  );
}
