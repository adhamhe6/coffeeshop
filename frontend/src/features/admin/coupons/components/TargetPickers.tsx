import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { Badge, Button, Checkbox, Input, Skeleton } from '@/design';
import {
  productNameKey,
  useCouponCategories,
  useCouponProductSearch,
  useProductNames,
} from '@/lib/api/adminMarketing';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export function CategoryPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const categories = useCouponCategories();
  if (categories.isPending) return <Skeleton className="h-24 w-full" />;
  if (categories.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        Categories could not be loaded.{' '}
        <button className="underline" type="button" onClick={() => void categories.refetch()}>
          Try again
        </button>
      </p>
    );
  return (
    <div
      role="group"
      aria-label="Categories this applies to"
      className="grid gap-2 rounded-md border border-border-strong p-3 sm:grid-cols-2"
    >
      {(categories.data ?? []).map((c) => (
        <Checkbox
          key={c.id}
          label={c.is_active ? c.name : `${c.name} (hidden)`}
          checked={value.includes(c.id)}
          onCheckedChange={(checked) =>
            onChange(checked === true ? [...value, c.id] : value.filter((id) => id !== c.id))
          }
        />
      ))}
    </div>
  );
}

export function ProductPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 250);
  const results = useCouponProductSearch(debounced);
  const names = useProductNames(value);

  return (
    <div className="grid gap-3">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected products">
          {value.map((id) => (
            <li key={id}>
              <Badge tone="outline" size="md" className="gap-1 py-1 pr-1 pl-2.5">
                {names[id] ?? `Product #${id}`}
                <button
                  type="button"
                  aria-label={`Remove ${names[id] ?? `product ${id}`}`}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-surface-sunken"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">No products chosen yet.</p>
      )}
      <div>
        <label htmlFor="coupon-product-search" className="sr-only">
          Search products to add
        </label>
        <Input
          id="coupon-product-search"
          type="search"
          size="sm"
          leading={<Search aria-hidden="true" />}
          placeholder="Search products by name to add"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul
        className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border"
        aria-label="Product search results"
        aria-busy={results.isFetching || undefined}
      >
        {results.isPending ? (
          <li className="p-3 text-sm text-text-muted">Loading products…</li>
        ) : (results.data ?? []).length === 0 ? (
          <li className="p-3 text-sm text-text-muted">No products found.</li>
        ) : (
          (results.data ?? []).map((p) => {
            const picked = value.includes(p.id);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-text-muted">{p.category_name}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={picked}
                  aria-label={picked ? `${p.name} already added` : `Add ${p.name}`}
                  leadingIcon={<Plus aria-hidden="true" className="size-3.5" />}
                  onClick={() => {
                    qc.setQueryData(productNameKey(p.id), { id: p.id, name: p.name });
                    onChange([...value, p.id]);
                  }}
                >
                  {picked ? 'Added' : 'Add'}
                </Button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
