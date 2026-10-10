import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { DataTable, EmptyState, Skeleton, type Column } from '@/design';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

export interface ReportColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Cell for the totals row (omit for an empty cell). */
  total?: ReactNode;
  /** Server sort key (`?ordering=`). */
  sortKey?: string;
  className?: string;
}

interface Props<T> {
  caption: string;
  columns: ReportColumn<T>[];
  rows: readonly T[] | undefined;
  getRowId: (row: T, index: number) => string | number;
  loading?: boolean;
  /** Shows a final "Total" row when any column defines `total`. */
  showTotals?: boolean;
  totalLabel?: string;
  sort?: { key: string; direction: 'asc' | 'desc' } | null;
  onSort?: (key: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Report table: right-aligned tabular figures, sticky header, a totals row that comes from the API (never summed
 * in the browser), horizontal scroll when wide. Below `md` it becomes stacked cards and the totals become a card.
 */
export function ReportTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  loading,
  showTotals = true,
  totalLabel = 'Total',
  sort,
  onSort,
  emptyTitle = 'Nothing to report',
  emptyDescription = 'There is no data for these filters.',
}: Props<T>) {
  const narrow = useMediaQuery('(max-width: 767.98px)');
  const hasTotals = showTotals && columns.some((c) => c.total !== undefined);
  const empty = !loading && (rows?.length ?? 0) === 0;

  if (narrow) {
    const cols: Column<T>[] = columns.map((c, i) => ({
      id: c.id,
      header: c.header,
      cell: c.cell,
      primary: i === 0,
    }));
    return (
      <div className="grid gap-3">
        <DataTable
          caption={caption}
          columns={cols}
          data={rows}
          getRowId={getRowId as (row: T) => string | number}
          loading={loading}
          empty={<EmptyState title={emptyTitle} description={emptyDescription} />}
        />
        {hasTotals && !empty ? (
          <div className="rounded-lg border border-border-strong bg-surface-sunken p-4">
            <p className="font-semibold">{totalLabel}</p>
            <dl className="mt-2 grid gap-1.5 text-sm">
              {columns
                .filter((c, i) => i > 0 && c.total !== undefined)
                .map((c) => (
                  <div key={c.id} className="flex items-baseline justify-between gap-4">
                    <dt className="text-text-muted">{c.header}</dt>
                    <dd className="text-right font-medium tabular-nums">{c.total}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-border bg-surface-raised"
      aria-busy={loading || undefined}
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-sunken">
          <tr>
            {columns.map((c) => {
              const active = sort && c.sortKey && sort.key === c.sortKey;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={
                    c.sortKey && onSort
                      ? active
                        ? sort?.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                  className={cn(
                    'border-b border-border px-3 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-text-muted uppercase',
                    c.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {c.sortKey && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sortKey as string)}
                      className={cn(
                        '-mx-1.5 inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 uppercase hover:text-text',
                        active && 'text-text',
                        c.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {c.header}
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
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }, (_, r) => (
                <tr key={r} className="border-b border-border">
                  {columns.map((c) => (
                    <td key={c.id} className="px-3 py-3">
                      <Skeleton className={cn('h-4 w-3/4', c.align === 'right' && 'ml-auto')} />
                    </td>
                  ))}
                </tr>
              ))
            : (rows ?? []).map((row, i) => (
                <tr
                  key={getRowId(row, i)}
                  className="border-b border-border last:border-0 hover:bg-surface/70"
                >
                  {columns.map((c, ci) =>
                    ci === 0 ? (
                      <th
                        key={c.id}
                        scope="row"
                        className={cn(
                          'px-3 py-2 text-left font-medium whitespace-nowrap',
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </th>
                    ) : (
                      <td
                        key={c.id}
                        className={cn(
                          'px-3 py-2',
                          c.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
          {empty ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : null}
        </tbody>
        {hasTotals && !empty && !loading ? (
          <tfoot>
            <tr className="border-t-2 border-border-strong bg-surface-sunken font-semibold">
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.id} scope="row" className="px-3 py-2.5 text-left">
                    {c.total ?? totalLabel}
                  </th>
                ) : (
                  <td
                    key={c.id}
                    className={cn(
                      'px-3 py-2.5',
                      c.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                    )}
                  >
                    {c.total}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Label/value strip above a table for totals that do not fit a column. */
export function SummaryStrip({
  items,
}: {
  items: { label: string; value: ReactNode; hint?: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border border-border bg-surface-raised p-3">
          <dt className="text-[0.8125rem] text-text-muted">{i.label}</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums">{i.value}</dd>
          {i.hint ? <p className="mt-0.5 text-xs text-text-muted">{i.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}
