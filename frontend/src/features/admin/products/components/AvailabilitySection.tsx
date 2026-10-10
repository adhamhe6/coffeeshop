import { Link } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import { Controller, useFormContext } from 'react-hook-form';
import { Ban, CircleCheckBig, TriangleAlert } from 'lucide-react';
import { Badge, RadioCard, RadioGroup, Skeleton, Switch } from '@/design';
import { aqk } from '@/lib/api/adminKeys';
import { adminInventoryApi, useStockList } from '@/lib/api/adminInventory';
import { useBranchOptions } from '@/lib/api/adminBranches';
import type { AdminProduct } from '@/lib/api/adminCatalog';
import type { ProductFormValues } from '../productForm';
import { SectionCard } from './SectionCard';
import { useEditor } from './editorContext';

function StockedSummary({ product }: { product: AdminProduct }) {
  const stock = useStockList({ product: product.id, page_size: 100 });
  if (stock.isPending) return <Skeleton className="h-16 w-full" />;
  if (stock.isError) return <p className="text-sm text-danger">Could not load stock levels.</p>;
  const rows = stock.data?.results ?? [];
  if (rows.length === 0)
    return (
      <p className="text-sm text-text-muted">
        No stock has been received at any branch you can see yet. Record a stock receipt in{' '}
        <Link
          className="text-accent-text underline underline-offset-4"
          to={`/admin/inventory?q=${encodeURIComponent(product.sku)}`}
        >
          Inventory
        </Link>
        .
      </p>
    );
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
          <span className="min-w-32 font-medium">{r.branch.name}</span>
          <span className="tabular-nums">{r.quantity} in stock</span>
          <span className="text-text-muted">alert at {r.low_stock_threshold}</span>
          {r.quantity === 0 ? (
            <Badge tone="danger" size="sm">
              <Ban aria-hidden="true" /> Out of stock
            </Badge>
          ) : r.is_low ? (
            <Badge tone="warning" size="sm">
              <TriangleAlert aria-hidden="true" /> Low stock
            </Badge>
          ) : (
            <Badge tone="success" size="sm">
              <CircleCheckBig aria-hidden="true" /> OK
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

function PreparedSummary({ product }: { product: AdminProduct }) {
  const branches = useBranchOptions();
  const list = branches.data ?? [];
  const results = useQueries({
    queries: list.map((b) => ({
      queryKey: aqk.inventory.availability({ branch: b.id, q: product.sku, page_size: 5 }),
      queryFn: () => adminInventoryApi.availability({ branch: b.id, q: product.sku, page_size: 5 }),
    })),
  });
  if (branches.isPending) return <Skeleton className="h-16 w-full" />;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {list.map((b, i) => {
        const res = results[i];
        const row = res?.data?.results.find((r) => r.product.id === product.id);
        return (
          <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-32 font-medium">{b.name}</span>
            {res?.isPending ? (
              <Skeleton className="h-5 w-24" />
            ) : res?.isError || !row ? (
              <span className="text-text-muted">Not available to check</span>
            ) : row.is_available ? (
              <Badge tone="success" size="sm">
                <CircleCheckBig aria-hidden="true" /> Available today
              </Badge>
            ) : (
              <Badge tone="warning" size="sm">
                <Ban aria-hidden="true" /> Switched off here
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AvailabilitySection() {
  const { product, isNew, readOnly, canViewInventory } = useEditor();
  const { control, watch } = useFormContext<ProductFormValues>();
  const mode = watch('stock_mode');

  return (
    <SectionCard
      id="availability"
      title="Availability"
      description="Whether customers can order this product, and how its availability is tracked."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <Switch
              label="Active"
              description="Visible on the storefront and orderable. Turn off to archive: order history is kept."
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={readOnly}
            />
          )}
        />
        <Controller
          control={control}
          name="is_sold_out"
          render={({ field }) => (
            <Switch
              label="Sold out everywhere"
              description="Shows Sold out on every branch right now. Use per-branch availability for single locations."
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={readOnly}
            />
          )}
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">How availability is tracked</legend>
        <Controller
          control={control}
          name="stock_mode"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              disabled={readOnly}
              className="md:grid-cols-2"
              aria-label="Stock mode"
            >
              <RadioCard
                value="PREPARED"
                title="Prepared to order"
                description="Drinks and food made on demand. Always available unless you switch it off for a branch (“86 it”) or mark it sold out."
              />
              <RadioCard
                value="STOCKED"
                title="Stock-managed"
                description="Beans, equipment and merchandise. Each branch has a quantity; it sells out at zero and low-stock alerts apply."
              />
            </RadioGroup>
          )}
        />
        {product && mode !== product.stock_mode ? (
          <p className="mt-2 text-sm text-warning" role="status">
            Changing how availability is tracked takes effect when you save. Existing stock rows are
            kept but only count for stock-managed products.
          </p>
        ) : null}
      </fieldset>

      {isNew ? (
        <p className="text-sm text-text-muted">
          Per-branch availability appears here after the product is created.
        </p>
      ) : product && canViewInventory ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">
              {product.stock_mode === 'STOCKED' ? 'Stock by branch' : 'Availability by branch'}
            </h3>
            <Link
              className="text-sm text-accent-text underline underline-offset-4"
              to={
                product.stock_mode === 'STOCKED'
                  ? `/admin/inventory?q=${encodeURIComponent(product.sku)}`
                  : '/admin/inventory?tab=availability'
              }
            >
              Open in Inventory
            </Link>
          </div>
          {product.stock_mode === 'STOCKED' ? (
            <StockedSummary product={product} />
          ) : (
            <PreparedSummary product={product} />
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}
