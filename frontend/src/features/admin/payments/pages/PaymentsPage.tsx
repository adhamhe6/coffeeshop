import { Link, useSearchParams } from 'react-router';
import { Info, Search, X } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
  Pagination,
  Select,
  StatusBadge,
  fromOrdering,
  toOrdering,
  type Column,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import {
  useAdminPayments,
  type AdminPayment,
  type AdminPaymentListParams,
} from '@/lib/api/adminPayments';
import { useBranchOptions } from '@/lib/api/adminReports';
import { useStore } from '@/lib/api/store';
import { useUrlSearchInput } from '../../ops/useUrlSearchInput';
import { MultiSelectFilter } from '../../ops/MultiSelectFilter';
import { PageHeader } from '../../ops/PageHeader';
import { BranchSelect } from '../../ops/ReportFilterBar';
import { Segmented } from '../../ops/Segmented';
import { formatInt, formatShortDateTime } from '../../ops/format';
import { PaymentDrawer } from '../components/PaymentDrawer';
import { FlaggedTag, SandboxTag } from '../components/PaymentParts';

const PAGE_SIZE = 20;
const ANY = 'any';

type Quick = 'all' | 'failed' | 'needs_refund' | 'flagged';
const QUICK: { value: Quick; label: string }[] = [
  { value: 'all', label: 'All payments' },
  { value: 'failed', label: 'Failed' },
  { value: 'needs_refund', label: 'Needs refund' },
  { value: 'flagged', label: 'Flagged' },
];

const PAYMENT_STATUSES = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'REQUIRES_ACTION', label: 'Action required' },
  { value: 'AUTHORIZED', label: 'Authorised' },
  { value: 'PAID', label: 'Paid' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
];
const PROVIDERS = [
  { value: 'stripe', label: 'Card (Stripe)' },
  { value: 'demo', label: 'Demo sandbox' },
  { value: 'cash', label: 'Cash' },
];

const PROVIDER_SHORT: Record<string, string> = {
  stripe: 'Card (Stripe)',
  demo: 'Demo (sandbox)',
  cash: 'Cash',
};

const csv = (v: string | null) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function paymentParamsFromSearch(search: URLSearchParams): AdminPaymentListParams {
  const sandbox = search.get('sandbox');
  return {
    q: search.get('q') || undefined,
    status: csv(search.get('status')).length ? csv(search.get('status')) : undefined,
    provider: search.get('provider') || undefined,
    is_sandbox: sandbox === 'yes' ? true : sandbox === 'no' ? false : undefined,
    branch: search.get('branch') || undefined,
    date_from: search.get('from') || undefined,
    date_to: search.get('to') || undefined,
    failed: search.get('failed') === 'true' || undefined,
    needs_refund: search.get('needs_refund') === 'true' || undefined,
    flagged: search.get('flagged') === 'true' || undefined,
    ordering: search.get('ordering') || '-created_at',
    page: Number(search.get('page')) || 1,
  };
}

export default function AdminPaymentsPage() {
  useSeo({ title: 'Payments · Admin', noindex: true });
  const { hasCapability } = useAuth();
  const { data: store } = useStore();
  const [search, setSearch] = useSearchParams();
  const params = paymentParamsFromSearch(search);
  const { data, isPending, isError, error, refetch, isFetching } = useAdminPayments(params);
  const { data: branchOptions } = useBranchOptions();

  const set = (patch: Record<string, string | null>) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        if (!('page' in patch) && !('payment' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );

  const [qInput, setQInput] = useUrlSearchInput(params.q ?? '', (q) => set({ q: q || null }));

  const quick: Quick = params.failed
    ? 'failed'
    : params.needs_refund
      ? 'needs_refund'
      : params.flagged
        ? 'flagged'
        : 'all';
  const setQuick = (q: Quick) =>
    set({
      failed: q === 'failed' ? 'true' : null,
      needs_refund: q === 'needs_refund' ? 'true' : null,
      flagged: q === 'flagged' ? 'true' : null,
    });

  const openId = Number(search.get('payment')) || null;
  const filtersActive = [
    'q',
    'status',
    'provider',
    'sandbox',
    'branch',
    'from',
    'to',
    'failed',
    'needs_refund',
    'flagged',
  ].some((k) => search.get(k));
  const pageCount = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
  const multiBranch = (branchOptions?.length ?? 2) > 1;
  const canRefund = hasCapability('payments.refund');
  const stripeMissing =
    data?.results.some((p) => p.provider === 'stripe') &&
    store &&
    !store.checkout_methods?.includes('stripe');

  const columns: Column<AdminPayment>[] = [
    {
      id: 'created_at',
      header: 'Created',
      sortable: true,
      className: 'whitespace-nowrap',
      primary: true,
      cell: (p) => (
        <button
          type="button"
          onClick={() => set({ payment: String(p.id) })}
          className="rounded-xs text-left font-medium underline-offset-4 hover:underline"
          aria-label={`Open payment ${p.id}, ${p.provider_label}, ${p.status}`}
        >
          <span className="tabular-nums">{formatShortDateTime(p.created_at)}</span>
        </button>
      ),
    },
    {
      id: 'order',
      header: 'Order',
      className: 'whitespace-nowrap',
      cell: (p) => (
        <span className="grid">
          {hasCapability('orders.view') ? (
            <Link
              to={`/admin/orders/${encodeURIComponent(p.order.number)}`}
              className="rounded-xs tabular-nums underline-offset-4 hover:underline"
            >
              {p.order.number}
            </Link>
          ) : (
            <span className="tabular-nums">{p.order.number}</span>
          )}
          <span className="text-xs text-text-muted">{p.order.customer_name}</span>
        </span>
      ),
    },
    ...(multiBranch
      ? [{ id: 'branch', header: 'Branch', cell: (p: AdminPayment) => p.order.branch_name }]
      : []),
    {
      id: 'provider',
      header: 'Provider',
      cell: (p) => (
        <span className="grid gap-1">
          <span>{PROVIDER_SHORT[p.provider] ?? p.provider_label}</span>
          {p.is_sandbox && p.provider !== 'demo' ? <SandboxTag provider={p.provider} /> : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (p) => (
        <span className="grid justify-items-start gap-1">
          <StatusBadge kind="payment" status={p.status} />
          <FlaggedTag reason={p.flagged_reason} />
          {p.needs_refund && !p.flagged_reason ? (
            <span className="text-xs font-medium text-warning">Refund needed</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      sortable: true,
      align: 'right',
      cell: (p) => <Money value={p.amount} className="font-medium" />,
    },
    {
      id: 'refunded_total',
      header: 'Refunded',
      hideOnNarrow: true,
      align: 'right',
      cell: (p) =>
        Number(p.refunded_total) > 0 ? (
          <Money value={p.refunded_total} />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      id: 'paid_at',
      header: 'Paid',
      sortable: true,
      className: 'whitespace-nowrap',
      cell: (p) =>
        p.paid_at ? formatShortDateTime(p.paid_at) : <span className="text-text-muted">—</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      narrowLabel: 'Actions',
      align: 'right',
      cell: (p) => (
        <Button size="sm" variant="secondary" onClick={() => set({ payment: String(p.id) })}>
          {canRefund && Number(p.refundable_amount) > 0 ? 'Details / refund' : 'Details'}
        </Button>
      ),
    },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Payments & refunds"
        description="Every payment attempt. Refunds are made through the payment provider and cancelling an order does not refund it."
      />

      {stripeMissing ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">Stripe is not set up in this environment.</strong>{' '}
            Stripe payments listed here cannot be refunded from the dashboard; use the Stripe
            dashboard for the real charge.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <Segmented label="Quick filter" value={quick} onChange={setQuick} options={QUICK} />
      </div>
      <form
        role="search"
        aria-label="Filter payments"
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-end gap-x-3 gap-y-2"
      >
        <Field label="Search payments" hideLabel className="w-full sm:w-72">
          <Input
            type="search"
            size="sm"
            className="max-md:h-11"
            placeholder="Order #, email or reference"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            leading={<Search aria-hidden="true" />}
          />
        </Field>
        <MultiSelectFilter
          label="Status"
          options={PAYMENT_STATUSES}
          selected={params.status ?? []}
          onChange={(v) => set({ status: v.join(',') || null })}
        />
        <Field label="Provider" hideLabel>
          <Select
            size="sm"
            aria-label="Provider"
            value={params.provider ?? ANY}
            onValueChange={(v) => set({ provider: v === ANY ? null : v })}
            options={[{ value: ANY, label: 'Any provider' }, ...PROVIDERS]}
            className="min-w-40 max-md:h-11"
          />
        </Field>
        <Field label="Real or sandbox" hideLabel>
          <Select
            size="sm"
            aria-label="Real or sandbox"
            value={search.get('sandbox') ?? ANY}
            onValueChange={(v) => set({ sandbox: v === ANY ? null : v })}
            options={[
              { value: ANY, label: 'Real and sandbox' },
              { value: 'no', label: 'Real money only' },
              { value: 'yes', label: 'Sandbox only' },
            ]}
            className="min-w-44 max-md:h-11"
          />
        </Field>
        <BranchSelect value={String(params.branch ?? '')} onChange={(id) => set({ branch: id })} />
        <Field label="Created from">
          <Input
            type="date"
            size="sm"
            value={params.date_from ?? ''}
            max={params.date_to}
            onChange={(e) => set({ from: e.target.value })}
            className="w-40 max-md:h-11"
          />
        </Field>
        <Field label="Created to">
          <Input
            type="date"
            size="sm"
            value={params.date_to ?? ''}
            min={params.date_from}
            onChange={(e) => set({ to: e.target.value })}
            className="w-40 max-md:h-11"
          />
        </Field>
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setQInput('');
              setSearch(new URLSearchParams(), { replace: true });
            }}
            leadingIcon={<X aria-hidden="true" className="size-4" />}
          >
            Clear filters
          </Button>
        ) : null}
      </form>

      <p className="text-sm text-text-muted" role="status" aria-live="polite">
        {data ? `${formatInt(data.count)} payment${data.count === 1 ? '' : 's'}` : ' '}
        {isFetching && !isPending ? ' · updating…' : ''}
      </p>

      {isError && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
        <DataTable
          caption="Payments"
          narrowQuery="(max-width: 1023.98px)"
          columns={columns}
          data={data?.results}
          getRowId={(p) => p.id}
          loading={isPending}
          sort={fromOrdering(params.ordering)}
          onSortChange={(s) => set({ ordering: toOrdering(s) ?? null })}
          empty={
            <EmptyState
              title={filtersActive ? 'No payments match these filters' : 'No payments yet'}
              description={
                filtersActive
                  ? 'Try removing a filter.'
                  : 'Payments appear here when customers pay for orders.'
              }
            />
          }
        />
      )}
      <Pagination
        page={params.page ?? 1}
        pageCount={pageCount}
        onPageChange={(p) => set({ page: String(p) })}
      />

      <PaymentDrawer paymentId={openId} onClose={() => set({ payment: null })} />
    </div>
  );
}
