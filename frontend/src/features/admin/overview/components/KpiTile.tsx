import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/design';
import { DefinitionTip } from '../../ops/DefinitionTip';

export type DeltaGoodWhen = 'up' | 'down' | 'neutral';

interface KpiTileProps {
  label: string;
  definitionKey: string;
  value: ReactNode;
  /** Previous period value, already formatted. */
  previous?: ReactNode;
  deltaPct: number | null | undefined;
  /** Which direction is good news; `neutral` never colours the change. */
  goodWhen?: DeltaGoodWhen;
  loading?: boolean;
  className?: string;
}

/**
 * One headline number: label with its definition, the value (tabular figures), and the change against the previous
 * period as arrow + "Up/Down" text + percent. Colour reinforces whether the change is good news; it is never the only cue.
 */
export function KpiTile({
  label,
  definitionKey,
  value,
  previous,
  deltaPct,
  goodWhen = 'up',
  loading,
  className,
}: KpiTileProps) {
  const hasDelta = deltaPct !== null && deltaPct !== undefined;
  const flat = hasDelta && Math.abs(deltaPct) < 0.05;
  const up = hasDelta && deltaPct > 0;
  const good = goodWhen === 'neutral' || flat ? null : (goodWhen === 'up') === up;
  const tone = good === null ? 'text-text-muted' : good ? 'text-success' : 'text-danger';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface-raised p-3.5', className)}
      aria-busy={loading || undefined}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-[0.8125rem] font-medium text-text-muted">{label}</p>
        <DefinitionTip definitionKey={definitionKey} label={label} />
      </div>
      <div className="mt-1 font-display text-2xl leading-tight font-semibold tabular-nums">
        {loading ? <Skeleton className="h-7 w-24" /> : value}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
        {loading ? (
          <Skeleton className="h-3.5 w-28" />
        ) : hasDelta ? (
          <>
            <span
              className={cn('inline-flex items-center gap-0.5 font-semibold tabular-nums', tone)}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{flat ? 'No change' : up ? 'Up' : 'Down'} </span>
              {flat ? '0.0%' : `${Math.abs(deltaPct).toFixed(1)}%`}
            </span>
            {previous !== undefined ? <span className="tabular-nums">vs {previous}</span> : null}
          </>
        ) : (
          <span>
            {previous !== undefined && previous !== null ? (
              <>
                <span className="tabular-nums">vs {previous}</span> · no % change
              </>
            ) : (
              'No previous period to compare'
            )}
          </span>
        )}
      </div>
    </div>
  );
}
