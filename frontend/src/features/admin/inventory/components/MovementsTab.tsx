import { useState } from 'react';
import { X } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Pagination,
  Select,
  type Column,
} from '@/design';
import {
  MOVEMENT_LABELS,
  useMovements,
  type Movement,
  type MovementType,
} from '@/lib/api/adminInventory';
import { useUrlState } from '../../catalog-kit/useUrlState';

const PAGE_SIZE = 25;
const ANY = 'any';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

export function MovementsTab({ branch }: { branch: string }) {
  const { get, set, page } = useUrlState();
  const [reference, setReference] = useState(get('reference'));
  const movements = useMovements({
    page,
    page_size: PAGE_SIZE,
    branch: branch || undefined,
    product: get('product') || undefined,
    type: get('type') || undefined,
    date_from: get('from') || undefined,
    date_to: get('to') || undefined,
    reference: get('reference') || undefined,
  });
  const rows = movements.data?.results;
  const count = movements.data?.count ?? 0;
  const productFilter = get('product');
  const productName = rows?.[0]?.product.name;
  const filtersActive = Boolean(
    get('type') || get('from') || get('to') || get('reference') || productFilter,
  );

  const columns: Column<Movement>[] = [
    {
      id: 'created_at',
      header: 'When',
      cell: (m) => <span className="whitespace-nowrap">{when(m.created_at)}</span>,
    },
    {
      id: 'product',
      header: 'Product',
      primary: true,
      cell: (m) => (
        <div>
          <p className="font-medium">{m.product.name}</p>
          <p className="text-xs text-text-muted">
            {m.branch.name} · <span className="font-mono">{m.product.sku}</span>
          </p>
        </div>
      ),
    },
    {
      id: 'movement_type',
      header: 'Type',
      cell: (m) => (
        <Badge tone="neutral" size="sm">
          {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
        </Badge>
      ),
    },
    {
      id: 'quantity_delta',
      header: 'Change',
      align: 'right',
      cell: (m) => (
        <span className="font-medium tabular-nums">
          {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
        </span>
      ),
    },
    {
      id: 'quantity_after',
      header: 'Balance',
      align: 'right',
      cell: (m) => <span className="tabular-nums">{m.quantity_after}</span>,
    },
    {
      id: 'reference',
      header: 'Reference',
      cell: (m) => m.reference || <span className="text-text-muted">—</span>,
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (m) => m.reason || <span className="text-text-muted">—</span>,
    },
    {
      id: 'actor',
      header: 'By',
      cell: (m) =>
        m.actor ? m.actor.name || m.actor.email : <span className="text-text-muted">System</span>,
    },
  ];

  return (
    <div className="grid gap-3">
      <form
        className="grid gap-3 rounded-lg border border-border bg-surface-raised p-3 sm:grid-cols-2 lg:grid-cols-[12rem_10rem_10rem_minmax(10rem,1fr)_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          set({ reference });
        }}
      >
        <Select
          size="sm"
          aria-label="Movement type"
          value={get('type') || ANY}
          onValueChange={(v) => set({ type: v === ANY ? null : v })}
          options={[
            { value: ANY, label: 'All types' },
            ...(Object.keys(MOVEMENT_LABELS) as MovementType[]).map((t) => ({
              value: t,
              label: MOVEMENT_LABELS[t],
            })),
          ]}
        />
        <Field label="From" hideLabel>
          <Input
            type="date"
            size="sm"
            value={get('from')}
            onChange={(e) => set({ from: e.target.value })}
          />
        </Field>
        <Field label="To" hideLabel>
          <Input
            type="date"
            size="sm"
            value={get('to')}
            onChange={(e) => set({ to: e.target.value })}
          />
        </Field>
        <Field label="Reference" hideLabel>
          <Input
            type="search"
            size="sm"
            placeholder="Reference or order number"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" variant="secondary">
          Apply
        </Button>
        {productFilter ? (
          <div className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-5">
            <Badge tone="accent">Product: {productName ?? `#${productFilter}`}</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ product: null })}
              leadingIcon={<X aria-hidden="true" className="size-4" />}
            >
              Show all products
            </Button>
          </div>
        ) : null}
        {filtersActive && !productFilter ? (
          <div className="sm:col-span-2 lg:col-span-5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setReference('');
                set({ type: null, from: null, to: null, reference: null });
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : null}
      </form>
      {movements.isError && !movements.data ? (
        <ErrorState error={movements.error} onRetry={() => void movements.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Stock movement history"
            columns={columns}
            data={rows}
            getRowId={(m) => m.id}
            loading={movements.isPending}
            narrowQuery="(max-width: 1199.98px)"
            empty={
              <EmptyState
                title="No movements found"
                description="Stock changes appear here as they happen."
              />
            }
          />
          <Pagination
            page={page}
            pageCount={Math.ceil(count / PAGE_SIZE)}
            onPageChange={(p) => set({ page: p })}
          />
        </>
      )}
    </div>
  );
}
