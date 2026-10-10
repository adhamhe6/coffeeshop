import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BarListItem {
  key: string;
  label: ReactNode;
  /** Numeric magnitude drawn as the bar (must be ≥ 0; the scale always starts at zero). */
  value: number;
  /** Direct value label shown at the end of the row. */
  display: ReactNode;
  /** Secondary text under the label. */
  hint?: ReactNode;
}

/**
 * Horizontal bars with direct labels (no legend needed): label, bar on a zero baseline, value.
 * One accent colour; the bar is redundant with the printed value so colour never carries meaning.
 */
export function BarList({
  items,
  label,
  className,
}: {
  items: BarListItem[];
  label: string;
  className?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul aria-label={label} className={cn('grid gap-2.5', className)}>
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
        >
          <div className="min-w-0 truncate text-sm">{item.label}</div>
          <div className="text-right text-sm font-medium tabular-nums">{item.display}</div>
          <div className="col-span-2 h-1.5 rounded-pill bg-surface-sunken" aria-hidden="true">
            <div
              className="h-full rounded-pill bg-accent"
              style={{
                width: `${max > 0 ? Math.max((item.value / max) * 100, item.value > 0 ? 1.5 : 0) : 0}%`,
              }}
            />
          </div>
          {item.hint ? (
            <div className="col-span-2 -mt-0.5 text-xs text-text-muted">{item.hint}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
