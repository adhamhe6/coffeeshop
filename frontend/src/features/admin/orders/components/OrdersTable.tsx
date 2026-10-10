import { Link, useSearchParams } from 'react-router';
import { Search, X } from 'lucide-react';
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
  Switch,
  fromOrdering,
  toOrdering,
  type Column,
  type SortState,
} from '@/design';
import {
  useAdminOrders,
  type AdminOrderListParams,
  type AdminOrderRow,
} from '@/lib/api/adminOrders';
import { useBranchOptions } from '@/lib/api/adminReports';
import { useUrlSearchInput } from '../../ops/useUrlSearchInput';
import { MultiSelectFilter } from '../../ops/MultiSelectFilter';
import { BranchSelect } from '../../ops/ReportFilterBar';
import { formatAge, formatDateTime, formatInt } from '../../ops/format';
import {
  AttentionNote,
  ORDER_STATUS_OPTIONS,
  ORDER_TYPE_OPTIONS,
  OrderPaymentBadge,
  OrderTypeLabel,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  paymentMethodLabel,
} from './orderMeta';

const PAGE_SIZE = 20;
const ANY = 'any';

const csv = (v: string | null) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** URL ⇄ list params. The URL is the single source of truth, so a filtered view can be shared or bookmarked. */
export function orderParamsFromSearch(search: URLSearchParams): AdminOrderListParams {
  return {
    q: search.get('q') || undefined,
    status: csv(search.get('status')).length ? csv(search.get('status')) : undefined,
    payment_status: csv(search.get('pay')).length ? csv(search.get('pay')) : undefined,
    branch: search.get('branch') || undefined,
    order_type: search.get('type') || undefined,
    payment_method: search.get('method') || undefined,
    date_from: search.get('from') || undefined,
    date_to: search.get('to') || undefined,
    stuck: search.get('stuck') === 'true' ? true : undefined,
    ordering: search.get('ordering') || '-placed_at',
    page: Number(search.get('page')) || 1,
    page_size: PAGE_SIZE,
  };
}

export function OrdersTable() {
  const [search, setSearch] = useSearchParams();
  const params = orderParamsFromSearch(search);
  const { data, isPending, isError, error, refetch, isFetching } = useAdminOrders(params);

  const set = (patch: Record<string, string | null>) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );

  const [qInput, setQInput] = useUrlSearchInput(params.q ?? '', (q) => set({ q: q || null }));

  const sort: SortState | null = fromOrdering(params.ordering);
  const filtersActive = [
    'q',
    'status',
    'pay',
    'branch',
    'type',
    'method',
    'from',
    'to',
    'stuck',
  ].some((k) => search.get(k));
  const pageCount = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
  const { data: branchOptions } = useBranchOptions();
  const multiBranch = (branchOptions?.length ?? 2) > 1;

  const columns: Column<AdminOrderRow>[] = [
    {
      id: 'number',
      header: 'Order',
      sortable: true,
      primary: true,
      className: 'whitespace-nowrap',
      cell: (o) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Link
            to={`/admin/orders/${encodeURIComponent(o.number)}`}
            className="rounded-xs font-semibold whitespace-nowrap tabular-nums underline-offset-4 hover:underline"
          >
            {o.number}
          </Link>
          {o.is_demo ? (
            <span className="rounded-xs bg-neutral-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-neutral">
              Demo
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'placed_at',
      header: 'Placed',
      sortable: true,
      className: 'whitespace-nowrap',
      narrowLabel: 'Placed',
      cell: (o) => (
        <span title={formatDateTime(o.placed_at)} className="tabular-nums">
          {formatAge(o.age_minutes)} ago
        </span>
      ),
    },
    { id: 'customer_name', header: 'Customer', cell: (o) => o.customer_name },
    {
      id: 'order_type',
      header: 'Type',
      className: 'whitespace-nowrap',
      cell: (o) => <OrderTypeLabel type={o.order_type} />,
    },
    ...(multiBranch
      ? [{ id: 'branch', header: 'Branch', cell: (o: AdminOrderRow) => o.branch.name }]
      : []),
    {
      id: 'item_count',
      header: 'Items',
      align: 'right',
      cell: (o) => <span className="tabular-nums">{formatInt(o.item_count)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      sortable: true,
      cell: (o) => <StatusBadge kind="order" status={o.status} />,
    },
    {
      id: 'payment_status',
      header: 'Payment',
      sortable: true,
      cell: (o) => (
        <span className="grid gap-0.5">
          <OrderPaymentBadge status={o.payment_status} method={o.payment_method} />
          <span className="text-xs text-text-muted">{paymentMethodLabel(o.payment_method)}</span>
        </span>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
      cell: (o) => <Money value={o.total} className="font-medium" />,
    },
    {
      id: 'attention',
      header: 'Needs attention',
      cell: (o) =>
        o.needs_attention ? (
          <AttentionNote message={o.needs_attention.message} />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
  ];

  return (
    <div className="grid gap-3">
      <form
        role="search"
        aria-label="Filter orders"
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-end gap-x-3 gap-y-2"
      >
        <Field label="Search orders" hideLabel className="w-full sm:w-72">
          <Input
            type="search"
            size="sm"
            className="max-md:h-11"
            placeholder="Order #, name, email or phone"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            leading={<Search aria-hidden="true" />}
          />
        </Field>
        <MultiSelectFilter
          label="Status"
          options={ORDER_STATUS_OPTIONS}
          selected={params.status ?? []}
          onChange={(v) => set({ status: v.join(',') || null })}
        />
        <MultiSelectFilter
          label="Payment"
          options={PAYMENT_STATUS_OPTIONS}
          selected={params.payment_status ?? []}
          onChange={(v) => set({ pay: v.join(',') || null })}
        />
        <BranchSelect value={String(params.branch ?? '')} onChange={(id) => set({ branch: id })} />
        <Field label="Order type" hideLabel>
          <Select
            size="sm"
            aria-label="Order type"
            value={params.order_type ?? ANY}
            onValueChange={(v) => set({ type: v === ANY ? null : v })}
            options={[{ value: ANY, label: 'Pickup or delivery' }, ...ORDER_TYPE_OPTIONS]}
            className="min-w-44 max-md:h-11"
          />
        </Field>
        <Field label="Payment method" hideLabel>
          <Select
            size="sm"
            aria-label="Payment method"
            value={params.payment_method ?? ANY}
            onValueChange={(v) => set({ method: v === ANY ? null : v })}
            options={[{ value: ANY, label: 'Any payment method' }, ...PAYMENT_METHOD_OPTIONS]}
            className="min-w-48 max-md:h-11"
          />
        </Field>
        <Field label="Placed from">
          <Input
            type="date"
            size="sm"
            value={params.date_from ?? ''}
            max={params.date_to}
            onChange={(e) => set({ from: e.target.value })}
            className="w-40 max-md:h-11"
          />
        </Field>
        <Field label="Placed to">
          <Input
            type="date"
            size="sm"
            value={params.date_to ?? ''}
            min={params.date_from}
            onChange={(e) => set({ to: e.target.value })}
            className="w-40 max-md:h-11"
          />
        </Field>
        <Switch
          checked={Boolean(params.stuck)}
          onCheckedChange={(v) => set({ stuck: v ? 'true' : null })}
          label="Stuck only"
          className="pb-1.5"
        />
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setQInput('');
              setSearch(new URLSearchParams({ view: 'table' }), { replace: true });
            }}
            leadingIcon={<X aria-hidden="true" className="size-4" />}
          >
            Clear filters
          </Button>
        ) : null}
      </form>

      <p className="text-sm text-text-muted" role="status" aria-live="polite">
        {data ? `${formatInt(data.count)} order${data.count === 1 ? '' : 's'}` : ' '}
        {isFetching && !isPending ? ' · updating…' : ''}
      </p>

      {isError && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
        <DataTable
          caption="Orders"
          narrowQuery="(max-width: 1023.98px)"
          columns={columns}
          data={data?.results}
          getRowId={(o) => o.number}
          loading={isPending}
          sort={sort}
          onSortChange={(s) => set({ ordering: toOrdering(s) ?? null })}
          empty={
            <EmptyState
              title={filtersActive ? 'No orders match these filters' : 'No orders yet'}
              description={
                filtersActive
                  ? 'Try removing a filter or searching for something else.'
                  : 'Orders will show up here as customers place them.'
              }
              action={
                filtersActive ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setSearch(new URLSearchParams({ view: 'table' }), { replace: true })
                    }
                  >
                    Clear filters
                  </Button>
                ) : undefined
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
    </div>
  );
}
