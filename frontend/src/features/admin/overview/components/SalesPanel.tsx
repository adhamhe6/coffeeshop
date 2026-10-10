import { useMemo } from 'react';
import { Segmented } from '../../ops/Segmented';
import { GRANULARITY_OPTIONS } from '../../ops/ReportFilterBar';
import { Panel } from '../../ops/PageHeader';
import { TimeSeriesChart } from '../../ops/TimeSeriesChart';
import { useMoney } from '@/design';
import type { Dashboard, Granularity } from '@/lib/api/adminReports';
import { formatInt } from '../../ops/format';

export function useCompactMoney() {
  const { currency, locale, format } = useMoney();
  return useMemo(() => {
    const compact = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    return { full: (n: number) => format(n), tick: (n: number) => compact.format(n) };
  }, [currency, locale, format]);
}

/** Net sales and orders over time as two small charts (different scales never share an axis). */
export function SalesPanel({
  series,
  granularity,
  onGranularity,
  loading,
}: {
  series: Dashboard['series'];
  granularity: Granularity;
  onGranularity: (g: Granularity) => void;
  loading?: boolean;
}) {
  const money = useCompactMoney();
  const net = useMemo(
    () => series.map((p) => ({ bucket: p.bucket, value: Number(p.net_sales) })),
    [series],
  );
  const orders = useMemo(
    () => series.map((p) => ({ bucket: p.bucket, value: p.orders })),
    [series],
  );
  return (
    <Panel
      title="Sales over time"
      description="Counted orders only, grouped by the branch-local day they were placed."
      actions={
        <Segmented
          label="Group chart by"
          value={granularity}
          options={GRANULARITY_OPTIONS}
          onChange={onGranularity}
        />
      }
      className="min-w-0"
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <TimeSeriesChart
          title="Net sales"
          measure="Net sales"
          kind="area"
          data={net}
          granularity={granularity}
          formatValue={money.full}
          formatTick={money.tick}
          loading={loading}
        />
        <TimeSeriesChart
          title="Orders counted as sales"
          measure="Orders"
          kind="bar"
          data={orders}
          granularity={granularity}
          formatValue={formatInt}
          formatTick={formatInt}
          loading={loading}
        />
      </div>
    </Panel>
  );
}
