import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { Button, Input, Money, ProductImage, Skeleton } from '@/design';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { adminCatalogApi, type AdminCollectionProduct } from '@/lib/api/adminCatalog';

interface ProductPickerProps {
  /** Ids already in the collection (hidden from the results). */
  excludeIds: number[];
  onAdd: (product: AdminCollectionProduct) => void;
  disabled?: boolean;
}

/** Search the catalogue by name, SKU or slug and add products to the collection. */
export function ProductPicker({ excludeIds, onAdd, disabled }: ProductPickerProps) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 250);
  const results = useQuery({
    queryKey: ['admin', 'collection-picker', debounced],
    queryFn: ({ signal }) =>
      adminCatalogApi.products({ q: debounced, page_size: 12, active: true }, signal),
    enabled: debounced.length >= 2,
  });
  const rows = (results.data?.results ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <div className="grid gap-2">
      <label htmlFor="collection-picker" className="text-sm font-medium">
        Add products
      </label>
      <Input
        id="collection-picker"
        type="search"
        size="sm"
        placeholder="Search by name or SKU (2+ characters)"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        leading={<Search aria-hidden="true" />}
      />
      {debounced.length >= 2 ? (
        results.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : results.isError ? (
          <p role="alert" className="text-sm text-danger">
            Search failed. Try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted">
            No matching products that are not already in the collection.
          </p>
        ) : (
          <ul
            aria-label="Search results"
            className="divide-y divide-border rounded-md border border-border"
          >
            {rows.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-2.5 py-1.5">
                <ProductImage src={p.image} alt="" aspect="1/1" className="size-9 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-text-muted">
                    <span className="font-mono">{p.sku}</span> · {p.category_name} ·{' '}
                    <Money value={p.base_price} />
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  aria-label={`Add ${p.name}`}
                  leadingIcon={<Plus aria-hidden="true" className="size-4" />}
                  onClick={() =>
                    onAdd({
                      id: p.id,
                      name: p.name,
                      slug: p.slug,
                      image: p.image,
                      is_active: p.is_active,
                      base_price: p.base_price,
                    })
                  }
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
