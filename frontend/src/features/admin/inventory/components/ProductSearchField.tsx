import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Field, IconButton, Input } from '@/design';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { adminCatalogApi } from '@/lib/api/adminCatalog';

interface ProductSearchFieldProps {
  value: { id: number; name: string; sku: string } | undefined;
  onChange: (value: { id: number; name: string; sku: string } | undefined) => void;
}

/** Pick a stock-managed product by searching name or SKU. */
export function ProductSearchField({ value, onChange }: ProductSearchFieldProps) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 250);
  const results = useQuery({
    queryKey: ['admin', 'stocked-product-search', debounced],
    queryFn: ({ signal }) =>
      adminCatalogApi.products({ q: debounced, stock_mode: 'STOCKED', page_size: 8 }, signal),
    enabled: debounced.length >= 2 && !value,
  });

  if (value) {
    return (
      <Field label="Product" required>
        <div className="flex h-11 items-center justify-between gap-2 rounded-md border border-border-strong bg-surface-raised pl-3.5">
          <span className="truncate text-sm">
            {value.name} <span className="font-mono text-text-muted">{value.sku}</span>
          </span>
          <IconButton
            label="Choose a different product"
            size="icon-sm"
            onClick={() => onChange(undefined)}
            icon={<X aria-hidden="true" className="size-4" />}
          />
        </div>
      </Field>
    );
  }
  return (
    <Field label="Product" required hint="Search stock-managed products by name or SKU.">
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
        placeholder="e.g. Ethiopia"
      />
      {debounced.length >= 2 ? (
        <ul
          aria-label="Matching products"
          className="mt-1 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border"
        >
          {(results.data?.results ?? []).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-surface-sunken"
                onClick={() => onChange({ id: p.id, name: p.name, sku: p.sku })}
              >
                {p.name} <span className="font-mono text-text-muted">{p.sku}</span>
              </button>
            </li>
          ))}
          {results.isSuccess && results.data.results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">No stock-managed products found.</li>
          ) : null}
        </ul>
      ) : null}
    </Field>
  );
}
