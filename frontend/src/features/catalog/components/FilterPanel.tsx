import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMoney } from '@/hooks/useMoney';
import { Button, Checkbox, Input, Radio, RadioGroup } from '@/design';
import type { Facets } from '../api';
import { humanize, type MenuFilters } from '../filters';

interface FilterPanelProps {
  filters: MenuFilters;
  facets: Facets | undefined;
  onChange: (patch: Partial<MenuFilters>) => void;
  /** Offer a category filter (search results; the menu has category tabs instead). */
  showCategories?: boolean;
  className?: string;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3 border-b border-border pb-6 last:border-0">
      <h2 id={id} className="eyebrow text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PriceRange({
  filters,
  facets,
  onChange,
}: Pick<FilterPanelProps, 'filters' | 'facets' | 'onChange'>) {
  const { format } = useMoney();
  const [min, setMin] = useState(filters.minPrice);
  const [max, setMax] = useState(filters.maxPrice);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const range =
    facets?.price.min && facets.price.max
      ? `${format(facets.price.min)} to ${format(facets.price.max)}`
      : null;

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const lo = min.trim();
    const hi = max.trim();
    const valid = /^\d{0,6}(\.\d{1,2})?$/;
    if ((lo && !valid.test(lo)) || (hi && !valid.test(hi))) {
      setError('Enter prices as numbers, like 5 or 12.50.');
      return;
    }
    if (lo && hi && Number(lo) > Number(hi)) {
      setError('The minimum price cannot be higher than the maximum.');
      return;
    }
    setError(null);
    onChange({ minPrice: lo, maxPrice: hi });
  };

  return (
    <form onSubmit={apply} className="grid gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <label htmlFor={`${id}-min`} className="text-sm font-medium">
            Min price
          </label>
          <Input
            id={`${id}-min`}
            inputMode="decimal"
            placeholder={facets?.price.min ? String(Number(facets.price.min)) : '0'}
            value={min}
            invalid={Boolean(error)}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => setMin(e.target.value)}
            size="sm"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-max`} className="text-sm font-medium">
            Max price
          </label>
          <Input
            id={`${id}-max`}
            inputMode="decimal"
            placeholder={facets?.price.max ? String(Number(facets.price.max)) : ''}
            value={max}
            invalid={Boolean(error)}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => setMax(e.target.value)}
            size="sm"
          />
        </div>
      </div>
      {range ? <p className="text-sm text-text-muted">Menu prices run {range}.</p> : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" size="sm" className="justify-self-start">
        Apply price
      </Button>
    </form>
  );
}

/** Filter controls driven by `products/facets/`. Every change is applied immediately (and lands in the URL). */
export function FilterPanel({
  filters,
  facets,
  onChange,
  showCategories,
  className,
}: FilterPanelProps) {
  const types = facets?.types ?? [];
  const tags = facets?.tags ?? [];
  // A selected value that the current facet counts no longer list must stay visible so it can be unselected.
  const tagList =
    filters.tag && !tags.some((t) => t.slug === filters.tag)
      ? [{ slug: filters.tag, name: filters.tag, count: 0 }, ...tags]
      : tags;

  return (
    <div className={cn('grid gap-6', className)}>
      <Group title="Highlights">
        <div className="grid gap-3">
          <Checkbox
            className="py-2 sm:py-0"
            label="Seasonal"
            checked={filters.seasonal}
            onCheckedChange={(c) => onChange({ seasonal: c === true })}
          />
          <Checkbox
            className="py-2 sm:py-0"
            label="Bestsellers"
            checked={filters.bestseller}
            onCheckedChange={(c) => onChange({ bestseller: c === true })}
          />
          <Checkbox
            className="py-2 sm:py-0"
            label="New arrivals"
            checked={filters.isNew}
            onCheckedChange={(c) => onChange({ isNew: c === true })}
          />
        </div>
      </Group>

      {showCategories && (facets?.categories.length ?? 0) > 0 ? (
        <Group title="Category">
          <RadioGroup
            aria-label="Category"
            value={filters.category || 'ALL'}
            onValueChange={(v) => onChange({ category: v === 'ALL' ? '' : v })}
            className="gap-2.5"
          >
            <Radio className="py-1.5 sm:py-0.5" value="ALL" label="All categories" />
            {(facets?.categories ?? []).map((c) => (
              <Radio
                className="py-1.5 sm:py-0.5"
                key={c.slug}
                value={c.slug}
                label={
                  <span className="flex items-baseline gap-2">
                    {c.name}{' '}
                    <span className="text-sm text-text-muted tabular-nums">({c.count})</span>
                  </span>
                }
              />
            ))}
          </RadioGroup>
        </Group>
      ) : null}

      {types.length > 0 || filters.type ? (
        <Group title="Type">
          <RadioGroup
            aria-label="Product type"
            value={filters.type || 'ALL'}
            onValueChange={(v) => onChange({ type: v === 'ALL' ? '' : (v as MenuFilters['type']) })}
            className="gap-2.5"
          >
            <Radio className="py-1.5 sm:py-0.5" value="ALL" label="All types" />
            {types.map((t) => (
              <Radio
                className="py-1.5 sm:py-0.5"
                key={t.value}
                value={t.value}
                label={
                  <span className="flex items-baseline gap-2">
                    {t.label}{' '}
                    <span className="text-sm text-text-muted tabular-nums">({t.count})</span>
                  </span>
                }
              />
            ))}
            {filters.type && !types.some((t) => t.value === filters.type) ? (
              <Radio
                className="py-1.5 sm:py-0.5"
                value={filters.type}
                label={humanize(filters.type.toLowerCase())}
              />
            ) : null}
          </RadioGroup>
        </Group>
      ) : null}

      {tagList.length > 0 ? (
        <Group title="Dietary & style">
          <ul className="flex flex-wrap gap-2" aria-label="Dietary and style tags">
            {tagList.map((t) => {
              const on = filters.tag === t.slug;
              return (
                <li key={t.slug}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ tag: on ? '' : t.slug })}
                    className={cn(
                      'inline-flex h-11 items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium transition-colors sm:h-9',
                      on
                        ? 'border-accent bg-accent-soft text-accent-text'
                        : 'border-border-strong bg-surface-raised text-text hover:border-text',
                    )}
                  >
                    {on ? <Check aria-hidden="true" className="size-3.5" strokeWidth={3} /> : null}
                    {humanize(t.name)}
                    {t.count ? (
                      <span className="text-xs text-text-muted tabular-nums">{t.count}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Group>
      ) : null}

      <Group title="Price">
        {/* Remounted when the URL's price changes (chips, clear all, back/forward) so the inputs follow it. */}
        <PriceRange
          key={`${filters.minPrice}|${filters.maxPrice}`}
          filters={filters}
          facets={facets}
          onChange={onChange}
        />
      </Group>
    </div>
  );
}
