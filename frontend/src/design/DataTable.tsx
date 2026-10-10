import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Skeleton } from './Skeleton';

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

/** `{key:'name',direction:'desc'}` ⇄ DRF `ordering=-name` */
export const toOrdering = (sort: SortState | null | undefined) =>
  sort ? `${sort.direction === 'desc' ? '-' : ''}${sort.key}` : undefined;
export function fromOrdering(ordering: string | null | undefined): SortState | null {
  if (!ordering) return null;
  return ordering.startsWith('-')
    ? { key: ordering.slice(1), direction: 'desc' }
    : { key: ordering, direction: 'asc' };
}

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Server-side sortable; `sortKey` defaults to `id` and is what ends up in `?ordering=`. */
  sortable?: boolean;
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Column shown as the card title on narrow screens (default: first column). */
  primary?: boolean;
  /** Omit from the narrow card layout. */
  hideOnNarrow?: boolean;
  /** Plain-text label for card layout when `header` is not a string. */
  narrowLabel?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: readonly T[] | undefined;
  getRowId: (row: T) => string | number;
  /** Required accessible name for the table (visually hidden). */
  caption: string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  loading?: boolean;
  loadingRows?: number;
  /** Shown when `data` is empty and not loading. */
  empty?: ReactNode;
  /** Keep the header visible while the body scrolls inside this max height (e.g. `70vh`). */
  maxHeight?: string;
  /** Switch to the card list below this width. Default: Tailwind `md`. */
  narrowQuery?: string;
  className?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  data,
  getRowId,
  caption,
  sort,
  onSortChange,
  loading = false,
  loadingRows = 5,
  empty,
  maxHeight,
  narrowQuery = '(max-width: 767.98px)',
  className,
}: DataTableProps<T>) {
  const narrow = useMediaQuery(narrowQuery);
  const rows = data ?? [];
  const showEmpty = !loading && rows.length === 0;

  const requestSort = (col: Column<T>) => {
    if (!col.sortable || !onSortChange) return;
    const key = col.sortKey ?? col.id;
    if (!sort || sort.key !== key) onSortChange({ key, direction: 'asc' });
    else onSortChange({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
  };

  if (narrow) {
    const primary = columns.find((c) => c.primary) ?? columns[0];
    const rest = columns.filter((c) => c !== primary && !c.hideOnNarrow);
    const labelOf = (c: Column<T>) =>
      c.narrowLabel ?? (typeof c.header === 'string' ? c.header : c.id);
    return (
      <div className={className} aria-busy={loading || undefined}>
        <p className="sr-only">{caption}</p>
        {showEmpty ? (
          <div className="rounded-lg border border-border bg-surface-raised">{empty}</div>
        ) : (
          <ul className="grid gap-3" aria-label={caption}>
            {loading
              ? Array.from({ length: loadingRows }, (_, i) => (
                  <li
                    key={i}
                    className="grid gap-2 rounded-lg border border-border bg-surface-raised p-4"
                  >
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-2/3" />
                  </li>
                ))
              : rows.map((row) => (
                  <li
                    key={getRowId(row)}
                    className="rounded-lg border border-border bg-surface-raised p-4"
                  >
                    {primary ? <div className="font-medium">{primary.cell(row)}</div> : null}
                    <dl className="mt-2 grid gap-1.5 text-sm">
                      {rest.map((c) => (
                        <div key={c.id} className="flex items-baseline justify-between gap-4">
                          <dt className="text-text-muted">{labelOf(c)}</dt>
                          <dd className="text-right">{c.cell(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn('overflow-auto rounded-lg border border-border bg-surface-raised', className)}
      style={maxHeight ? { maxHeight } : undefined}
      aria-busy={loading || undefined}
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface-sunken">
          <tr>
            {columns.map((col) => {
              const key = col.sortKey ?? col.id;
              const active = sort?.key === key;
              const ariaSort = col.sortable
                ? active
                  ? sort?.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
                : undefined;
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    'border-b border-border px-4 py-2.5 text-xs font-semibold tracking-wide text-text-muted uppercase',
                    alignClass[col.align ?? 'left'],
                    col.className,
                  )}
                >
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => requestSort(col)}
                      className={cn(
                        '-mx-1.5 inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 uppercase hover:text-text',
                        active && 'text-text',
                        col.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {col.header}
                      {active ? (
                        sort?.direction === 'asc' ? (
                          <ArrowUp aria-hidden="true" className="size-3.5" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="size-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-60" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: loadingRows }, (_, r) => (
                <tr key={r} className="border-b border-border last:border-0">
                  {columns.map((c, i) => (
                    <td key={c.id} className="px-4 py-3.5">
                      <Skeleton
                        className={cn(
                          'h-4',
                          i === 0 ? 'w-2/3' : 'w-1/2',
                          c.align === 'right' && 'ml-auto',
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={getRowId(row)}
                  className="border-b border-border transition-colors last:border-0 hover:bg-surface/70"
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-4 py-3 align-middle',
                        alignClass[col.align ?? 'left'],
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          {showEmpty ? (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
