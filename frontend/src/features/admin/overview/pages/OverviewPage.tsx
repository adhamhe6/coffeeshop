import { useEffect, useState } from 'react';
import { FlaskConical, RefreshCw } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, ErrorState, Money, Skeleton } from '@/design';
import { useDashboard, type DashboardKpis } from '@/lib/api/adminReports';
import { useSeo } from '@/hooks/useSeo';
import { ReportFilterBar } from '../../ops/ReportFilterBar';
import { PageHeader } from '../../ops/PageHeader';
import { formatDay, formatInt, formatDateTime } from '../../ops/format';
import { useReportFilters } from '../../ops/useReportFilters';
import { AttentionPanel } from '../components/AttentionPanel';
import {
  BranchPanel,
  CategoryPanel,
  RecentCustomersPanel,
  RecentOrdersPanel,
  StatusPanel,
  TopProductsPanel,
} from '../components/BreakdownPanels';
import { KpiTile, type DeltaGoodWhen } from '../components/KpiTile';
import { SalesPanel } from '../components/SalesPanel';

type KpiKey = keyof DashboardKpis;

interface KpiSpec {
  key: KpiKey;
  label: string;
  definitionKey: string;
  money: boolean;
  goodWhen: DeltaGoodWhen;
}

const PRIMARY: KpiSpec[] = [
  {
    key: 'gross_sales',
    label: 'Gross sales',
    definitionKey: 'gross_sales',
    money: true,
    goodWhen: 'up',
  },
  {
    key: 'discounts',
    label: 'Discounts',
    definitionKey: 'discounts',
    money: true,
    goodWhen: 'neutral',
  },
  { key: 'net_sales', label: 'Net sales', definitionKey: 'net_sales', money: true, goodWhen: 'up' },
  { key: 'refunds', label: 'Refunds', definitionKey: 'refunds', money: true, goodWhen: 'down' },
  {
    key: 'orders_total',
    label: 'Orders placed',
    definitionKey: 'orders_total',
    money: false,
    goodWhen: 'up',
  },
  {
    key: 'average_order_value',
    label: 'Average order value',
    definitionKey: 'average_order_value',
    money: true,
    goodWhen: 'up',
  },
];
const SECONDARY: KpiSpec[] = [
  {
    key: 'orders_completed',
    label: 'Completed',
    definitionKey: 'orders_completed',
    money: false,
    goodWhen: 'up',
  },
  {
    key: 'orders_pending',
    label: 'In progress',
    definitionKey: 'orders_pending',
    money: false,
    goodWhen: 'neutral',
  },
  {
    key: 'orders_cancelled',
    label: 'Cancelled',
    definitionKey: 'orders_cancelled',
    money: false,
    goodWhen: 'down',
  },
  {
    key: 'payment_failures',
    label: 'Payment failures',
    definitionKey: 'payment_failures',
    money: false,
    goodWhen: 'down',
  },
  {
    key: 'revenue_collected',
    label: 'Revenue collected',
    definitionKey: 'revenue_collected',
    money: true,
    goodWhen: 'up',
  },
];

export default function AdminOverviewPage() {
  useSeo({ title: 'Overview · Admin', noindex: true });
  const { user } = useAuth();
  const { filters, setPreset, setCustom, setBranch, setGranularity } = useReportFilters();
  const { data, isPending, isError, error, refetch, isFetching } = useDashboard(filters.params);

  // Re-render the "updated" label if the data is older than a minute while the tab stays open.
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const period = data?.period;
  const periodLabel = period
    ? `${formatDay(period.date_from, true)} – ${formatDay(period.date_to, true)}`
    : null;
  const previousLabel = period
    ? `${formatDay(period.previous_date_from, true)} – ${formatDay(period.previous_date_to, true)}`
    : null;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Overview"
        description={user?.first_name ? `Welcome back, ${user.first_name}.` : undefined}
        meta={
          period ? (
            <p className="text-sm text-text-muted" data-testid="period-summary">
              <span className="font-medium text-text">{periodLabel}</span> compared with{' '}
              {previousLabel}
              {period.timezones.length ? ` · days in ${period.timezones.join(', ')}` : ''}
            </p>
          ) : null
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            loading={isFetching && !isPending}
            leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
          >
            Refresh
          </Button>
        }
      />

      <ReportFilterBar
        filters={filters}
        onPreset={setPreset}
        onCustom={setCustom}
        onBranch={setBranch}
      />

      {data?.is_demo_data ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-border-strong bg-accent-soft px-4 py-3 text-sm"
        >
          <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
          <p>
            <strong className="font-semibold">Demo data.</strong> Some orders in this period are
            seeded demonstration orders, so these figures are not real sales.
          </p>
        </div>
      ) : null}

      {isError && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
        <>
          <section aria-label="Key figures" className="grid gap-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {PRIMARY.map((spec) => (
                <Kpi key={spec.key} spec={spec} kpis={data?.kpis} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {SECONDARY.map((spec) => (
                <Kpi key={spec.key} spec={spec} kpis={data?.kpis} />
              ))}
            </div>
          </section>

          {isPending || !data ? (
            <DashboardSkeleton />
          ) : (
            <>
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <SalesPanel
                  series={data.series}
                  granularity={filters.granularity}
                  onGranularity={setGranularity}
                  loading={isFetching}
                />
                <AttentionPanel attention={data.attention} />
              </div>
              <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <StatusPanel rows={data.orders_by_status} />
                <CategoryPanel rows={data.category_sales} />
                <TopProductsPanel products={data.top_products} />
              </div>
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <RecentOrdersPanel rows={data.recent_orders} />
                <div className="grid gap-4">
                  {data.branch_performance.length > 1 ? (
                    <BranchPanel rows={data.branch_performance} />
                  ) : null}
                  {data.recent_customers.length > 0 ? (
                    <RecentCustomersPanel rows={data.recent_customers} />
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-text-muted">
                Updated {formatDateTime(data.generated_at)}. Figures are cached for up to a minute.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ spec, kpis }: { spec: KpiSpec; kpis: DashboardKpis | undefined }) {
  const k = kpis?.[spec.key];
  const fmt = (v: string | number | null | undefined) =>
    v === null || v === undefined ? undefined : spec.money ? (
      <Money value={v} />
    ) : (
      formatInt(Number(v))
    );
  return (
    <KpiTile
      label={spec.label}
      definitionKey={spec.definitionKey}
      value={fmt(k?.value)}
      previous={fmt(k?.previous)}
      deltaPct={k?.delta_pct}
      goodWhen={spec.goodWhen}
      loading={!k}
    />
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
