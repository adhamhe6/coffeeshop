import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Granularity } from '@/lib/api/adminReports';
import { formatDay } from './format';

export interface SeriesDatum {
  bucket: string;
  value: number;
}

const ACCENT = 'var(--color-accent)';
const GRID = 'var(--color-border)';
const AXIS = 'var(--color-text-muted)';

export function bucketLabel(bucket: string, granularity: Granularity, long = false): string {
  if (granularity === 'week') return `Week of ${formatDay(bucket, long)}`;
  if (granularity === 'month') {
    const d = new Date(`${bucket}T00:00:00`);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: long || d.getMonth() === 0 ? 'numeric' : undefined,
    }).format(d);
  }
  return formatDay(bucket, long);
}

interface Props {
  title: string;
  data: SeriesDatum[];
  kind: 'area' | 'bar';
  granularity: Granularity;
  /** Full-precision label for tooltips/table, e.g. `$1,234.50`. */
  formatValue: (n: number) => string;
  /** Compact label for axis ticks, e.g. `$1.2K`. */
  formatTick: (n: number) => string;
  /** Name of the measure for the accessible description ("Net sales"). */
  measure: string;
  loading?: boolean;
  height?: number;
}

/**
 * One measure over time: a single copper series on a zero baseline, light grid, labelled axes values, hover tooltip,
 * a plain-language summary and a table alternative. (Two measures with different scales are two charts, never a dual axis.)
 */
export function TimeSeriesChart({
  title,
  data,
  kind,
  granularity,
  formatValue,
  formatTick,
  measure,
  loading,
  height = 220,
}: Props) {
  const uid = useId();
  const total = data.reduce((n, d) => n + d.value, 0);
  const peak = data.reduce<SeriesDatum | null>(
    (best, d) => (!best || d.value > best.value ? d : best),
    null,
  );
  const summary = data.length
    ? `${measure} by ${granularity === 'day' ? 'day' : granularity}: total ${formatValue(total)}, highest ${formatValue(peak?.value ?? 0)} on ${bucketLabel(peak?.bucket ?? '', granularity, true)}.`
    : `No ${measure.toLowerCase()} in this period.`;

  return (
    <figure className="m-0" aria-busy={loading || undefined}>
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-sm font-medium">{title}</span>
        {data.length ? (
          <span className="text-sm text-text-muted tabular-nums">
            Peak {formatValue(peak?.value ?? 0)} · {bucketLabel(peak?.bucket ?? '', granularity)}
          </span>
        ) : null}
      </figcaption>
      <div role="img" aria-label={summary} style={{ height }} className="w-full">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            Nothing to chart for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height }}>
            {kind === 'area' ? (
              <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(b: string) => bucketLabel(b, granularity)}
                  tick={{ fill: AXIS, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={formatTick}
                  tick={{ fill: AXIS, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  domain={[0, 'auto']}
                />
                <ChartTooltip
                  cursor={{ stroke: AXIS, strokeDasharray: '3 3' }}
                  content={
                    <SeriesTooltip
                      granularity={granularity}
                      formatValue={formatValue}
                      measure={measure}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={ACCENT}
                  strokeWidth={2}
                  fill={`url(#${uid}-fill)`}
                  activeDot={{
                    r: 4,
                    stroke: 'var(--color-surface-raised)',
                    strokeWidth: 2,
                    fill: ACCENT,
                  }}
                  dot={data.length <= 2 ? { r: 3, fill: ACCENT } : false}
                  isAnimationActive={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(b: string) => bucketLabel(b, granularity)}
                  tick={{ fill: AXIS, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={formatTick}
                  tick={{ fill: AXIS, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
                  domain={[0, 'auto']}
                />
                <ChartTooltip
                  cursor={{ fill: 'var(--color-surface-sunken)' }}
                  content={
                    <SeriesTooltip
                      granularity={granularity}
                      formatValue={formatValue}
                      measure={measure}
                    />
                  }
                />
                <Bar
                  dataKey="value"
                  fill={ACCENT}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      {data.length ? (
        <details className="mt-2 text-sm">
          <summary className="inline-block cursor-pointer rounded-xs py-1 text-text-muted hover:text-text">
            View {measure.toLowerCase()} as a table
          </summary>
          <div className="mt-1 max-h-56 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 bg-surface-sunken text-left text-xs text-text-muted uppercase">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-semibold">
                    {granularity === 'day' ? 'Day' : granularity === 'week' ? 'Week' : 'Month'}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-semibold">
                    {measure}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.bucket} className="border-t border-border">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      {bucketLabel(d.bucket, granularity, true)}
                    </th>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}

function SeriesTooltip({
  active,
  payload,
  granularity,
  formatValue,
  measure,
}: {
  active?: boolean;
  payload?: { payload?: SeriesDatum }[];
  granularity: Granularity;
  formatValue: (n: number) => string;
  measure: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm shadow-md">
      <p className="text-text-muted">{bucketLabel(point.bucket, granularity, true)}</p>
      <p className="font-semibold tabular-nums">
        {formatValue(point.value)}{' '}
        <span className="font-normal text-text-muted">{measure.toLowerCase()}</span>
      </p>
    </div>
  );
}
