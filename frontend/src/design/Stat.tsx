import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Secondary line, e.g. "vs. last week". */
  hint?: ReactNode;
  /** Percent change. Sign is shown with an arrow + text, never colour alone. */
  delta?: number | null;
  icon?: ReactNode;
  loading?: boolean;
  className?: string;
}

export function Stat({ label, value, hint, delta, icon, loading, className }: StatProps) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface-raised p-4', className)}
      aria-busy={loading || undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-text-muted">{label}</p>
        {icon ? <span className="text-text-muted [&_svg]:size-4">{icon}</span> : null}
      </div>
      <p className="mt-2 font-display text-[1.75rem] leading-none font-semibold tabular-nums">
        {loading ? (
          <span
            className="inline-block h-7 w-24 animate-shimmer rounded-sm bg-surface-sunken"
            aria-hidden="true"
          />
        ) : (
          value
        )}
      </p>
      {(delta !== undefined && delta !== null) || hint ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-text-muted">
          {delta !== undefined && delta !== null ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                delta >= 0 ? 'text-success' : 'text-danger',
              )}
            >
              {delta >= 0 ? (
                <ArrowUpRight aria-hidden="true" className="size-4" />
              ) : (
                <ArrowDownRight aria-hidden="true" className="size-4" />
              )}
              <span className="sr-only">{delta >= 0 ? 'Up' : 'Down'} </span>
              {Math.abs(delta).toFixed(1)}%
            </span>
          ) : null}
          {hint}
        </p>
      ) : null}
    </div>
  );
}
