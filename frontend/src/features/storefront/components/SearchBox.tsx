import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useProductSuggestions } from '@/lib/api/catalog';
import { Money, ProductImage } from '@/design';

interface SearchBoxProps {
  className?: string;
  /** Called after the user navigates (close a dialog, etc.). */
  onNavigate?: () => void;
  placeholder?: string;
}

type Option = {
  id: string;
  label: string;
  to: string;
  kind: 'query' | 'product';
  image?: string | null;
  price?: string;
  category?: string;
};

/**
 * Header search with autocomplete from `products/suggest/` (ARIA 1.2 combobox with a listbox popup).
 * Enter submits `/search?q=…`; ArrowUp/Down moves through suggestions; Escape closes.
 */
export function SearchBox({
  className,
  onNavigate,
  placeholder = 'Search the menu',
}: SearchBoxProps) {
  const navigate = useNavigate();
  const listId = useId();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedValue(value.trim(), 200);
  const suggestions = useProductSuggestions(debounced);

  const query = value.trim();
  const items: Option[] = [];
  if (query.length >= 1) {
    items.push({
      id: `${listId}-q`,
      label: `Search for “${query}”`,
      to: `/search?q=${encodeURIComponent(query)}`,
      kind: 'query',
    });
  }
  if (query.length >= 2 && debounced === query) {
    for (const s of suggestions.data ?? []) {
      items.push({
        id: `${listId}-${s.slug}`,
        label: s.name,
        to: `/p/${s.slug}`,
        kind: 'product',
        image: s.image,
        price: s.base_price,
        category: s.category?.name,
      });
    }
  }
  const expanded = open && items.length > 0;
  const loading = query.length >= 2 && (suggestions.isFetching || debounced !== query);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    setActive(-1);
    navigate(to);
    onNavigate?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === 'Enter') {
      const chosen = active >= 0 ? items[active] : undefined;
      if (chosen) {
        e.preventDefault();
        go(chosen.to);
      }
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <form
        role="search"
        aria-label="Site"
        onSubmit={(e) => {
          e.preventDefault();
          if (query) go(`/search?q=${encodeURIComponent(query)}`);
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search products
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-muted"
          />
          <input
            id={`${listId}-input`}
            type="search"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={expanded && active >= 0 ? items[active]?.id : undefined}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="h-11 w-full rounded-pill border border-border-strong bg-surface-raised pr-10 pl-10 text-[0.9375rem] text-text placeholder:text-text-muted hover:border-text-muted focus-visible:border-text [&::-webkit-search-cancel-button]:hidden"
          />
          {loading ? (
            <Loader2
              aria-hidden="true"
              className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-text-muted motion-reduce:animate-none"
            />
          ) : null}
        </div>
      </form>
      <p className="sr-only" role="status" aria-live="polite">
        {expanded
          ? `${items.length} ${items.length === 1 ? 'suggestion' : 'suggestions'} available`
          : ''}
      </p>
      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[min(26rem,70dvh)] min-w-72 overflow-auto rounded-lg border border-border bg-surface-raised p-1.5 shadow-md"
        >
          {items.map((item, i) => (
            // Options are driven by the combobox input (keyboard); pointer users click them directly.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={item.id}
              id={item.id}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => go(item.to)}
              onPointerEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2',
                i === active && 'bg-surface-sunken',
              )}
            >
              {item.kind === 'query' ? (
                <>
                  <span className="flex size-10 items-center justify-center rounded-md bg-surface-sunken text-text-muted">
                    <Search aria-hidden="true" className="size-4" />
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{item.label}</span>
                  <ArrowRight aria-hidden="true" className="size-4 text-text-muted" />
                </>
              ) : (
                <>
                  <ProductImage src={item.image} alt="" aspect="1/1" className="size-10 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    {item.category ? (
                      <span className="block truncate text-xs text-text-muted">
                        {item.category}
                      </span>
                    ) : null}
                  </span>
                  {item.price ? (
                    <Money value={item.price} className="text-sm text-text-muted" />
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
