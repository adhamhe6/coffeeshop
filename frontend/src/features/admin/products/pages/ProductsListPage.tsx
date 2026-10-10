import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
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
  Select,
  toOrdering,
  type Column,
} from '@/design';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSeo } from '@/hooks/useSeo';
import {
  adminCatalogApi,
  PRODUCT_TYPES,
  useAdminCategories,
  useAdminProducts,
  useInvalidateCatalog,
  type AdminProductListParams,
  type AdminProductRow,
} from '@/lib/api/adminCatalog';
import { MiniSwitch } from '../../catalog-kit/MiniSwitch';
import { PageHeader } from '../../catalog-kit/PageHeader';
import { useUrlState } from '../../catalog-kit/useUrlState';
import { BulkActionDialog } from '../components/BulkActionDialog';
import { ProductStatus } from '../components/ProductStatus';
import { useProductToggle } from '../useProductToggle';
import type { BulkItem } from '../bulk';

const PAGE_SIZE = 25;
const ALL = 'all';

const SORTS = [
  { value: ALL, label: 'Menu order' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: 'base_price', label: 'Price, low to high' },
  { value: '-base_price', label: 'Price, high to low' },
  { value: '-updated_at', label: 'Recently updated' },
  { value: 'sku', label: 'SKU' },
  { value: 'stock_total', label: 'Stock, low to high' },
];

type BulkKind = 'activate' | 'deactivate' | 'feature' | 'unfeature';
const BULK: Record<
  BulkKind,
  {
    label: string;
    verb: string;
    title: string;
    consequence: string;
    patch: { is_active?: boolean; is_featured?: boolean };
  }
> = {
  activate: {
    label: 'Activate',
    verb: 'Activating',
    title: 'Activate products',
    consequence:
      'These products will appear on the storefront again (if their category is active).',
    patch: { is_active: true },
  },
  deactivate: {
    label: 'Archive',
    verb: 'Archiving',
    title: 'Archive products',
    consequence:
      'These products will disappear from the storefront and cannot be ordered. Order history is not affected and you can restore them later.',
    patch: { is_active: false },
  },
  feature: {
    label: 'Feature',
    verb: 'Featuring',
    title: 'Feature products',
    consequence: 'These products will be eligible for featured placements on the storefront.',
    patch: { is_featured: true },
  },
  unfeature: {
    label: 'Unfeature',
    verb: 'Updating',
    title: 'Remove featured flag',
    consequence: 'These products will no longer be featured.',
    patch: { is_featured: false },
  },
};

export default function AdminProductsListPage() {
  useSeo({ title: 'Products · Admin', noindex: true });
  const { hasCapability } = useAuth();
  const canManage = hasCapability('catalog.manage');
  const { get, set, page } = useUrlState();
  const invalidate = useInvalidateCatalog();
  const toggle = useProductToggle();

  // search box: local state, pushed to the URL after a pause
  const urlQ = get('q');
  const [search, setSearch] = useState(urlQ);
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debouncedSearch !== urlQ) set({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const status = get('status') || ALL;
  const ordering = get('ordering');
  const params: AdminProductListParams = {
    page,
    page_size: PAGE_SIZE,
    q: urlQ || undefined,
    category: get('category') || undefined,
    type: get('type') || undefined,
    stock_mode: get('stock_mode') || undefined,
    active: status === 'active' ? true : status === 'archived' ? false : undefined,
    is_sold_out: status === 'sold_out' ? true : undefined,
    is_featured: get('featured') ? true : undefined,
    low_stock: get('low') ? true : undefined,
    ordering: ordering || undefined,
  };
  const products = useAdminProducts(params);
  const categories = useAdminCategories();
  const rows = products.data?.results;
  const count = products.data?.count ?? 0;

  const filtersActive = Boolean(
    urlQ ||
    get('category') ||
    get('type') ||
    get('stock_mode') ||
    get('featured') ||
    get('low') ||
    status !== ALL,
  );
  const clearFilters = () => {
    setSearch('');
    set({
      q: null,
      category: null,
      type: null,
      stock_mode: null,
      status: null,
      featured: null,
      low: null,
    });
  };

  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── selection (kept across pages) ──
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const pageIds = useMemo(() => (rows ?? []).map((r) => r.id), [rows]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggleRow = (row: AdminProductRow, on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(row.id, row.name);
      else next.delete(row.id);
      return next;
    });
  const toggleAllOnPage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      (rows ?? []).forEach((r) => (on ? next.set(r.id, r.name) : next.delete(r.id)));
      return next;
    });
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const selectedItems: BulkItem[] = [...selected].map(([id, name]) => ({ id, name }));

  const columns: Column<AdminProductRow>[] = [
    ...(canManage
      ? [
          {
            id: 'select',
            header: (
              <Checkbox
                label={<span className="sr-only">Select all products on this page</span>}
                checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                onCheckedChange={(v) => toggleAllOnPage(v === true)}
                className="items-center"
              />
            ),
            narrowLabel: 'Select',
            className: 'w-10',
            cell: (r: AdminProductRow) => (
              <Checkbox
                label={<span className="sr-only">Select {r.name}</span>}
                checked={selected.has(r.id)}
                onCheckedChange={(v) => toggleRow(r, v === true)}
                className="items-center"
              />
            ),
          },
        ]
      : []),
    {
      id: 'name',
      header: 'Product',
      sortable: true,
      primary: true,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <ProductImage src={r.image} alt="" aspect="1/1" className="size-11 shrink-0" />
          <div className="min-w-0">
            <Link
              to={`/admin/products/${r.id}`}
              className="block truncate font-medium text-text hover:text-accent-text hover:underline"
            >
              {r.name}
            </Link>
            <p className="truncate text-xs text-text-muted">
              <span className="font-mono">{r.sku}</span> · {r.category_name}
              {r.is_demo ? ' · Demo' : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <ProductStatus
          isActive={r.is_active}
          isSoldOut={r.is_sold_out}
          lowStock={r.low_stock}
          stockTotal={r.stock_total}
        />
      ),
    },
    {
      id: 'price',
      header: 'Price',
      sortable: true,
      sortKey: 'base_price',
      align: 'right',
      cell: (r) => <Money value={r.base_price} className="font-medium" />,
    },
    {
      id: 'stock',
      header: 'Stock',
      sortable: true,
      sortKey: 'stock_total',
      cell: (r) =>
        r.stock_mode === 'STOCKED' ? (
          <span className="tabular-nums">{r.stock_total ?? 0} in stock</span>
        ) : (
          <span className="text-text-muted">Made to order</span>
        ),
    },
    {
      id: 'is_active',
      header: 'Active',
      align: 'center',
      cell: (r) => (
        <MiniSwitch
          checked={r.is_active}
          disabled={!canManage}
          label={`Active: ${r.name}`}
          onCheckedChange={(v) => toggle.mutate({ row: r, field: 'is_active', value: v })}
        />
      ),
    },
    {
      id: 'is_sold_out',
      header: 'Sold out',
      align: 'center',
      cell: (r) => (
        <MiniSwitch
          checked={r.is_sold_out}
          disabled={!canManage}
          label={`Sold out: ${r.name}`}
          onCheckedChange={(v) => toggle.mutate({ row: r, field: 'is_sold_out', value: v })}
        />
      ),
    },
    {
      id: 'is_featured',
      header: 'Featured',
      align: 'center',
      cell: (r) => (
        <MiniSwitch
          checked={r.is_featured}
          disabled={!canManage}
          label={`Featured: ${r.name}`}
          onCheckedChange={(v) => toggle.mutate({ row: r, field: 'is_featured', value: v })}
        />
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      narrowLabel: 'Actions',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button asChild variant="secondary" size="sm">
            <Link
              to={`/admin/products/${r.id}`}
              aria-label={`${canManage ? 'Edit' : 'View'} ${r.name}`}
            >
              {canManage ? 'Edit' : 'View'}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon-sm">
            <a
              href={`/p/${r.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${r.name} on the storefront (opens in a new tab)`}
            >
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </Button>
        </div>
      ),
    },
  ];

  const categoryOptions = [
    { value: ALL, label: 'All categories' },
    ...(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name })),
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        description={
          products.data
            ? `${count} product${count === 1 ? '' : 's'}${filtersActive ? ' match your filters' : ' in the catalogue'}.`
            : 'Manage everything customers can order.'
        }
        actions={
          canManage ? (
            <Button asChild leadingIcon={<Plus aria-hidden="true" className="size-4" />}>
              <Link to="/admin/products/new">New product</Link>
            </Button>
          ) : null
        }
      />

      <section
        aria-label="Filters"
        className="mb-4 grid gap-3 rounded-lg border border-border bg-surface-raised p-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1.4fr)_repeat(5,minmax(0,1fr))]"
      >
        <div className="md:col-span-2 xl:col-span-1">
          <label htmlFor="product-search" className="sr-only">
            Search products
          </label>
          <Input
            id="product-search"
            type="search"
            size="sm"
            placeholder="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leading={<Search aria-hidden="true" />}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="md:hidden"
          aria-expanded={filtersOpen}
          aria-controls="product-filter-panel"
          onClick={() => setFiltersOpen((o) => !o)}
          leadingIcon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
        >
          {filtersOpen ? 'Hide filters' : filtersActive ? 'Filters (active)' : 'Filters'}
        </Button>
        <div
          id="product-filter-panel"
          className={filtersOpen ? 'grid gap-3 md:contents' : 'hidden md:contents'}
        >
          <Select
            size="sm"
            aria-label="Category"
            value={get('category') || ALL}
            onValueChange={(v) => set({ category: v === ALL ? null : v })}
            options={categoryOptions}
          />
          <Select
            size="sm"
            aria-label="Status"
            value={status}
            onValueChange={(v) => set({ status: v === ALL ? null : v })}
            options={[
              { value: ALL, label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'sold_out', label: 'Sold out' },
            ]}
          />
          <Select
            size="sm"
            aria-label="Product type"
            value={get('type') || ALL}
            onValueChange={(v) => set({ type: v === ALL ? null : v })}
            options={[{ value: ALL, label: 'Any type' }, ...PRODUCT_TYPES]}
          />
          <Select
            size="sm"
            aria-label="Stock mode"
            value={get('stock_mode') || ALL}
            onValueChange={(v) => set({ stock_mode: v === ALL ? null : v })}
            options={[
              { value: ALL, label: 'Any stock mode' },
              { value: 'PREPARED', label: 'Made to order' },
              { value: 'STOCKED', label: 'Stock-managed' },
            ]}
          />
          <Select
            size="sm"
            aria-label="Sort by"
            value={ordering || ALL}
            onValueChange={(v) => set({ ordering: v === ALL ? null : v })}
            options={SORTS}
          />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:col-span-2 xl:col-span-6">
            <Checkbox
              label="Featured only"
              checked={Boolean(get('featured'))}
              onCheckedChange={(v) => set({ featured: v === true ? '1' : null })}
            />
            <Checkbox
              label="Low stock only"
              checked={Boolean(get('low'))}
              onCheckedChange={(v) => set({ low: v === true ? '1' : null })}
            />
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                leadingIcon={<X aria-hidden="true" className="size-4" />}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {canManage && selected.size > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent-soft px-3 py-2"
        >
          <p className="mr-auto text-sm font-medium" aria-live="polite">
            {selected.size} selected
          </p>
          {(Object.keys(BULK) as BulkKind[]).map((k) => (
            <Button key={k} variant="secondary" size="sm" onClick={() => setBulk(k)}>
              {BULK[k].label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {products.isError && !products.data ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Products"
            columns={columns}
            data={rows}
            getRowId={(r) => r.id}
            loading={products.isPending}
            loadingRows={8}
            narrowQuery="(max-width: 1199.98px)"
            sort={fromOrdering(ordering)}
            onSortChange={(s) => set({ ordering: toOrdering(s) })}
            empty={
              <EmptyState
                title={filtersActive ? 'No products match these filters' : 'No products yet'}
                description={
                  filtersActive
                    ? 'Try a different search or clear the filters.'
                    : 'Add your first product to start selling.'
                }
                action={
                  filtersActive ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : canManage ? (
                    <Button asChild>
                      <Link to="/admin/products/new">New product</Link>
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          <Pagination
            className="mt-4"
            page={page}
            pageCount={Math.ceil(count / PAGE_SIZE)}
            onPageChange={(p) => set({ page: p })}
          />
        </>
      )}

      {bulk ? (
        <BulkActionDialog
          open
          onOpenChange={(o) => !o && setBulk(null)}
          title={BULK[bulk].title}
          consequence={BULK[bulk].consequence}
          verb={BULK[bulk].verb}
          items={selectedItems}
          action={(item) => adminCatalogApi.updateProduct(item.id, BULK[bulk].patch)}
          onFinished={(results) => {
            setSelected((prev) => {
              const next = new Map(prev);
              results.filter((r) => r.ok).forEach((r) => next.delete(r.id));
              return next;
            });
            void invalidate(['products']);
          }}
        />
      ) : null}
    </div>
  );
}
