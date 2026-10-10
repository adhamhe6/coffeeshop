import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** Number of sibling pages shown around the current one. */
  siblings?: number;
}

/** Page numbers with ellipses: 1 … 4 [5] 6 … 20 */
export function getPageItems(
  page: number,
  pageCount: number,
  siblings = 1,
): Array<number | 'gap-start' | 'gap-end'> {
  const total = siblings * 2 + 5;
  if (pageCount <= total) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const left = Math.max(page - siblings, 2);
  const right = Math.min(page + siblings, pageCount - 1);
  const items: Array<number | 'gap-start' | 'gap-end'> = [1];
  if (left > 2) items.push('gap-start');
  for (let p = left; p <= right; p++) items.push(p);
  if (right < pageCount - 1) items.push('gap-end');
  items.push(pageCount);
  return items;
}

const base =
  'inline-flex h-10 min-w-10 items-center justify-center rounded-md px-2.5 text-sm font-medium tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40';

export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
  siblings = 1,
}: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-center gap-1', className)}
    >
      <button
        type="button"
        className={cn(base, 'gap-1 pr-3 hover:bg-surface-sunken')}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">Previous</span>
      </button>
      <ul className="flex items-center gap-1">
        {getPageItems(page, pageCount, siblings).map((item) =>
          typeof item === 'number' ? (
            <li key={item}>
              <button
                type="button"
                className={cn(
                  base,
                  item === page ? 'bg-espresso text-cream' : 'hover:bg-surface-sunken',
                )}
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => item !== page && onPageChange(item)}
              >
                {item}
              </button>
            </li>
          ) : (
            <li key={item} aria-hidden="true" className="px-1 text-text-muted">
              …
            </li>
          ),
        )}
      </ul>
      <button
        type="button"
        className={cn(base, 'gap-1 pl-3 hover:bg-surface-sunken')}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}
