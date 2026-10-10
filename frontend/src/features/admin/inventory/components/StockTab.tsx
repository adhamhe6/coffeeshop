import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Ban,
  CircleCheckBig,
  History,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  fromOrdering,
  Input,
  Money,
  Pagination,
  ProductImage,
  toOrdering,
  type Column,
} from '@/design';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useStockList, type StockItem } from '@/lib/api/adminInventory';
import { useUrlState } from '../../catalog-kit/useUrlState';
import { AdjustStockDialog, type AdjustTarget } from './AdjustStockDialog';
import { StockSettingsDialog } from './StockSettingsDialog';

const PAGE_SIZE = 25;

export function StockBadge({ item }: { item: Pick<StockItem, 'quantity' | 'is_low'> }) {
  if (item.quantity === 0)
    return (
      <Badge tone="danger" size="sm">
        <Ban aria-hidden="true" /> Out of stock
      </Badge>
    );
  if (item.is_low)
    return (
      <Badge tone="warning" size="sm">
        <TriangleAlert aria-hidden="true" /> Low stock
      </Badge>
    );
  return (
    <Badge tone="success" size="sm">
      <CircleCheckBig aria-hidden="true" /> In stock
    </Badge>
  );
}

export function StockTab({ branch, canManage }: { branch: string; canManage: boolean }) {
  const { get, set, page } = useUrlState();
  const [search, setSearch] = useState(get('q'));
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== get('q')) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const ordering = get('ordering');
  const stock = useStockList({
    page,
    page_size: PAGE_SIZE,
    branch: branch || undefined,
    q: get('q') || undefined,
    low: get('low') ? true : undefined,
    out_of_stock: get('out') ? true : undefined,
    ordering: ordering || undefined,
  });
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null);
  const [settings, setSettings] = useState<StockItem | null>(null);
  const rows = stock.data?.results;
  const count = stock.data?.count ?? 0;
  const filtersActive = Boolean(get('q') || get('low') || get('out'));

  const columns: Column<StockItem>[] = [
    {
      id: 'product__name',
      header: 'Product',
      sortable: true,
      primary: true,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <ProductImage src={r.product.image} alt="" aspect="1/1" className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-medium">{r.product.name}</p>
            <p className="font-mono text-xs text-text-muted">{r.product.sku}</p>
          </div>
        </div>
      ),
    },
    { id: 'branch__name', header: 'Branch', sortable: true, cell: (r) => r.branch.name },
    {
      id: 'quantity',
      header: 'On hand',
      sortable: true,
      align: 'right',
      cell: (r) => <span className="font-medium tabular-nums">{r.quantity}</span>,
    },
    { id: 'status', header: 'Status', cell: (r) => <StockBadge item={r} /> },
    {
      id: 'low_stock_threshold',
      header: 'Alert at',
      sortable: true,
      align: 'right',
      cell: (r) => <span className="tabular-nums">{r.low_stock_threshold}</span>,
    },
    {
      id: 'unit_cost',
      header: 'Unit cost',
      align: 'right',
      cell: (r) =>
        r.unit_cost ? (
          <Money value={r.unit_cost} />
        ) : (
          <span className="text-text-muted">Not set</span>
        ),
    },
    {
      id: 'stock_value',
      header: 'Value',
      sortable: true,
      align: 'right',
      cell: (r) =>
        r.stock_value ? (
          <Money value={r.stock_value} />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      narrowLabel: 'Actions',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canManage ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Adjust stock of ${r.product.name} at ${r.branch.name}`}
                onClick={() =>
                  setAdjust({
                    branchId: r.branch.id,
                    product: { id: r.product.id, name: r.product.name, sku: r.product.sku },
                  })
                }
              >
                Adjust
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Settings for ${r.product.name} at ${r.branch.name}`}
                onClick={() => setSettings(r)}
              >
                <SlidersHorizontal aria-hidden="true" className="size-4" />
              </Button>
            </>
          ) : null}
          <Button asChild size="icon-sm" variant="ghost">
            <Link
              aria-label={`Movement history of ${r.product.name}`}
              to={`/admin/inventory?tab=movements&product=${r.product.id}${branch ? `&branch=${branch}` : ''}`}
            >
              <History aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-surface-raised p-3">
        <div className="w-full sm:w-72">
          <label htmlFor="stock-search" className="sr-only">
            Search stock
          </label>
          <Input
            id="stock-search"
            type="search"
            size="sm"
            placeholder="Search product or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leading={<Search aria-hidden="true" />}
          />
        </div>
        <Checkbox
          label="Low stock"
          checked={Boolean(get('low'))}
          onCheckedChange={(v) => set({ low: v === true ? '1' : null })}
        />
        <Checkbox
          label="Out of stock"
          checked={Boolean(get('out'))}
          onCheckedChange={(v) => set({ out: v === true ? '1' : null })}
        />
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              set({ q: null, low: null, out: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {stock.isError && !stock.data ? (
        <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Stock levels"
            columns={columns}
            data={rows}
            getRowId={(r) => r.id}
            loading={stock.isPending}
            sort={fromOrdering(ordering)}
            onSortChange={(s) => set({ ordering: toOrdering(s) })}
            narrowQuery="(max-width: 1023.98px)"
            empty={
              <EmptyState
                title={filtersActive ? 'No stock matches these filters' : 'No stock tracked yet'}
                description={
                  filtersActive
                    ? 'Clear the filters to see everything.'
                    : 'Stock-managed products (beans, equipment, merchandise) appear here once you receive stock.'
                }
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
      {adjust ? <AdjustStockDialog target={adjust} onClose={() => setAdjust(null)} /> : null}
      {settings ? <StockSettingsDialog item={settings} onClose={() => setSettings(null)} /> : null}
    </div>
  );
}
