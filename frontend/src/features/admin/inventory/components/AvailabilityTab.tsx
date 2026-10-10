import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleCheckBig, Search } from 'lucide-react';
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  ProductImage,
  Select,
  toast,
  type Column,
} from '@/design';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { aqk } from '@/lib/api/adminKeys';
import { adminInventoryApi, useAvailability, type AvailabilityRow } from '@/lib/api/adminInventory';
import { qk } from '@/lib/api/keys';
import type { Paginated } from '@/lib/api/types';
import { errorText } from '../../catalog-kit/errors';
import { MiniSwitch } from '../../catalog-kit/MiniSwitch';
import { useUrlState } from '../../catalog-kit/useUrlState';

const PAGE_SIZE = 25;
const ANY = 'any';

/** Per-branch on/off for made-to-order products ("86 it today"). Optimistic with rollback. */
export function AvailabilityTab({
  branchId,
  branchName,
  canManage,
}: {
  branchId: number | null;
  branchName: string;
  canManage: boolean;
}) {
  const { get, set, page } = useUrlState();
  const qc = useQueryClient();
  const [search, setSearch] = useState(get('q'));
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== get('q')) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const filter = get('available') || ANY;
  const params =
    branchId === null
      ? null
      : {
          branch: branchId,
          page,
          page_size: PAGE_SIZE,
          q: get('q') || undefined,
          available: filter === 'on' ? true : filter === 'off' ? false : undefined,
        };
  const availability = useAvailability(params);

  const toggle = useMutation({
    mutationFn: (v: { row: AvailabilityRow; value: boolean }) =>
      adminInventoryApi.setAvailability({
        branch: branchId ?? 0,
        product: v.row.product.id,
        is_available: v.value,
      }),
    onMutate: async ({ row, value }) => {
      await qc.cancelQueries({ queryKey: aqk.inventory.all });
      const snapshot = qc.getQueriesData<Paginated<AvailabilityRow>>({
        queryKey: [...aqk.inventory.all, 'availability'],
      });
      for (const [key, data] of snapshot) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          results: data.results.map((r) =>
            r.product.id === row.product.id ? { ...r, is_available: value } : r,
          ),
        });
      }
      return { snapshot };
    },
    onError: (e, { row }, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(`Could not update ${row.product.name}. ${errorText(e)}`);
    },
    onSuccess: (_d, { row, value }) =>
      toast.success(
        `${row.product.name} is ${value ? 'back on' : 'switched off'} at ${branchName}.`,
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: aqk.inventory.all });
      void qc.invalidateQueries({ queryKey: qk.products.all });
    },
  });

  const columns: Column<AvailabilityRow>[] = [
    {
      id: 'product',
      header: 'Product',
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
    { id: 'category', header: 'Category', cell: (r) => r.category_name },
    {
      id: 'status',
      header: 'Status here',
      cell: (r) =>
        r.is_sold_out ? (
          <Badge tone="danger" size="sm">
            <Ban aria-hidden="true" /> Sold out everywhere
          </Badge>
        ) : r.is_available ? (
          <Badge tone="success" size="sm">
            <CircleCheckBig aria-hidden="true" /> Available
          </Badge>
        ) : (
          <Badge tone="warning" size="sm">
            <Ban aria-hidden="true" /> Switched off
          </Badge>
        ),
    },
    {
      id: 'toggle',
      header: 'Available today',
      narrowLabel: 'Available today',
      align: 'center',
      cell: (r) => (
        <MiniSwitch
          checked={r.is_available}
          disabled={!canManage}
          label={`Available at ${branchName}: ${r.product.name}`}
          onCheckedChange={(v) => toggle.mutate({ row: r, value: v })}
        />
      ),
    },
  ];

  if (branchId === null) {
    return <EmptyState title="Choose a branch" description="Availability is set per branch." />;
  }
  const rows = availability.data?.results;
  const count = availability.data?.count ?? 0;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-text-muted">
        Made-to-order items at <strong className="font-medium text-text">{branchName}</strong>.
        Switch one off when you run out (“86 it”); customers ordering from this branch will see it
        as unavailable. Stock-managed products are controlled by their quantity instead.
      </p>
      <div className="grid gap-3 rounded-lg border border-border bg-surface-raised p-3 sm:grid-cols-[minmax(14rem,24rem)_12rem]">
        <div>
          <label htmlFor="availability-search" className="sr-only">
            Search products
          </label>
          <Input
            id="availability-search"
            type="search"
            size="sm"
            placeholder="Search product or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leading={<Search aria-hidden="true" />}
          />
        </div>
        <Select
          size="sm"
          aria-label="Availability filter"
          value={filter}
          onValueChange={(v) => set({ available: v === ANY ? null : v })}
          options={[
            { value: ANY, label: 'All products' },
            { value: 'on', label: 'Available only' },
            { value: 'off', label: 'Switched off only' },
          ]}
        />
      </div>
      {availability.isError && !availability.data ? (
        <ErrorState error={availability.error} onRetry={() => void availability.refetch()} />
      ) : (
        <>
          <DataTable
            caption={`Availability at ${branchName}`}
            columns={columns}
            data={rows}
            getRowId={(r) => r.product.id}
            loading={availability.isPending}
            empty={
              <EmptyState
                title="No products found"
                description="Try a different search or filter."
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
