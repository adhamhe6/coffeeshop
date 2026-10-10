import { Link } from 'react-router';
import { Search, Users } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Money,
  Pagination,
  Select,
  fromOrdering,
  toOrdering,
  type Column,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { PAGE_SIZE, useAdminCustomers } from '@/lib/api/adminPeople';
import type { AdminCustomerRow } from '@/lib/api/peopleTypes';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { formatDate, formatRelative } from '../../people-kit/datetime';
import { useDebouncedSearch, useListState } from '../../people-kit/useListState';
import { AccountStatusBadge } from '../components/AccountStatusBadge';

const FILTERS = ['is_active'] as const;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All accounts' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Suspended only' },
];

export default function CustomersPage() {
  useSeo({ title: 'Customers', noindex: true });
  const { params, update, setPage } = useListState(FILTERS);
  const query = useAdminCustomers(params);
  const [text, setText] = useDebouncedSearch(params.search ?? '', (v) =>
    update({ search: v || undefined }),
  );
  const sort = fromOrdering(params.ordering as string | undefined);
  const page = params.page ?? 1;
  const total = query.data?.count ?? 0;

  const columns: Column<AdminCustomerRow>[] = [
    {
      id: 'customer',
      header: 'Customer',
      narrowLabel: 'Customer',
      primary: true,
      sortable: true,
      sortKey: 'last_name',
      cell: (c) => (
        <div className="min-w-0">
          <Link
            to={`/admin/customers/${c.id}`}
            className="font-medium text-text underline-offset-4 hover:text-accent-text hover:underline"
          >
            {c.full_name || c.email}
          </Link>
          <div className="truncate text-sm text-text-muted">{c.email}</div>
        </div>
      ),
    },
    {
      id: 'phone',
      header: 'Phone',
      hideOnNarrow: true,
      cell: (c) => <span className="tabular-nums">{c.phone || '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => <AccountStatusBadge active={c.is_active} />,
    },
    {
      id: 'order_count',
      header: 'Orders',
      sortable: true,
      align: 'right',
      cell: (c) => <span className="tabular-nums">{c.order_count}</span>,
    },
    {
      id: 'lifetime_spend',
      header: 'Lifetime spend',
      sortable: true,
      align: 'right',
      cell: (c) => <Money value={c.lifetime_spend} />,
    },
    {
      id: 'last_order_at',
      header: 'Last order',
      sortable: true,
      cell: (c) => (
        <span title={c.last_order_at ?? undefined}>
          {c.last_order_at ? formatRelative(c.last_order_at) : 'No orders'}
        </span>
      ),
    },
    {
      id: 'date_joined',
      header: 'Joined',
      sortable: true,
      hideOnNarrow: true,
      cell: (c) => formatDate(c.date_joined),
    },
  ];

  const filtered = Boolean(params.search || params.is_active);

  return (
    <div>
      <AdminPageHeader
        title="Customers"
        description="Everyone who has created an account. Open a customer to see their orders or to suspend or restore their account."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-80">
          <label htmlFor="customer-search" className="sr-only">
            Search customers by name, email or phone
          </label>
          <Input
            id="customer-search"
            type="search"
            size="sm"
            leading={<Search aria-hidden="true" />}
            placeholder="Search name, email or phone"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select
            size="sm"
            aria-label="Filter by account status"
            options={STATUS_OPTIONS}
            value={(params.is_active as string | undefined) ?? 'all'}
            onValueChange={(v) => update({ is_active: v === 'all' ? undefined : v })}
          />
        </div>
        <p className="ml-auto text-sm text-text-muted" aria-live="polite">
          {query.data ? `${total} customer${total === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Customers"
            columns={columns}
            data={query.data?.results}
            getRowId={(c) => c.id}
            loading={query.isPending}
            sort={sort}
            onSortChange={(s) => update({ ordering: toOrdering(s) })}
            empty={
              <EmptyState
                icon={<Users aria-hidden="true" />}
                title={filtered ? 'No customers match' : 'No customers yet'}
                description={
                  filtered
                    ? 'Try a different name, email or phone number, or clear the status filter.'
                    : 'Customers appear here as soon as they register.'
                }
              />
            }
          />
          <Pagination
            className="mt-4"
            page={page}
            pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
