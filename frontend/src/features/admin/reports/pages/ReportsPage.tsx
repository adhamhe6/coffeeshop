import { useState, type ComponentType } from 'react';
import { BookOpen, Download, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/app/auth';
import {
  Button,
  Sheet,
  SheetContent,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design';
import {
  reportCsvUrl,
  useBranchOptions,
  useReportDefinitions,
  type ReportKind,
} from '@/lib/api/adminReports';
import { useSeo } from '@/hooks/useSeo';
import { PageHeader } from '../../ops/PageHeader';
import { ReportFilterBar } from '../../ops/ReportFilterBar';
import { formatDay } from '../../ops/format';
import { useReportFilters } from '../../ops/useReportFilters';
import {
  BranchesReportPanel,
  CategoriesReportPanel,
  CustomersReportPanel,
  InventoryReportPanel,
  PaymentsReportPanel,
  ProductsReportPanel,
  PromotionsReportPanel,
  RefundsReportPanel,
  SalesReportPanel,
  StatusReportPanel,
  type PanelProps,
} from '../components/ReportPanels';

const TABS: { kind: ReportKind; label: string; Panel: ComponentType<PanelProps> }[] = [
  { kind: 'sales', label: 'Sales', Panel: SalesReportPanel },
  { kind: 'products', label: 'Products', Panel: ProductsReportPanel },
  { kind: 'categories', label: 'Categories', Panel: CategoriesReportPanel },
  { kind: 'branches', label: 'Branches', Panel: BranchesReportPanel },
  { kind: 'promotions', label: 'Promotions', Panel: PromotionsReportPanel },
  { kind: 'payments', label: 'Payments', Panel: PaymentsReportPanel },
  { kind: 'refunds', label: 'Refunds', Panel: RefundsReportPanel },
  { kind: 'inventory', label: 'Inventory', Panel: InventoryReportPanel },
  { kind: 'customers', label: 'Customers', Panel: CustomersReportPanel },
  { kind: 'orders-by-status', label: 'Orders by status', Panel: StatusReportPanel },
];

export default function AdminReportsPage() {
  const { hasCapability } = useAuth();
  const [search, setSearch] = useSearchParams();
  const { filters, setPreset, setCustom, setBranch, setGranularity, update } = useReportFilters();
  const [defsOpen, setDefsOpen] = useState(false);
  const { data: branches } = useBranchOptions();

  const tab = TABS.find((t) => t.kind === search.get('tab')) ?? TABS[0]!;
  useSeo({ title: `${tab.label} report · Admin`, noindex: true });
  const page = Number(search.get('page')) || 1;
  const ordering = search.get('ordering') || undefined;
  const status = search.get('status') || undefined;

  const canExport = hasCapability('reports.export');
  const params = {
    ...filters.params,
    ordering: tab.kind === 'products' || tab.kind === 'inventory' ? ordering : undefined,
    status: tab.kind === 'inventory' ? status : undefined,
  };
  const csvHref = reportCsvUrl(tab.kind, params);
  const branchName = filters.branch
    ? (branches?.find((b) => String(b.id) === filters.branch)?.name ?? `Branch ${filters.branch}`)
    : branches && branches.length > 1
      ? 'All branches'
      : (branches?.[0]?.name ?? 'All branches');
  const periodText = `${formatDay(filters.params.date_from ?? '', true)} – ${formatDay(filters.params.date_to ?? '', true)}`;

  const setTab = (kind: string) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', kind);
        // Pagination / sorting belong to one report only.
        next.delete('page');
        next.delete('ordering');
        next.delete('status');
        return next;
      },
      { replace: true },
    );

  const Panel = tab.Panel;
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Reports"
        description="The same figures as the Overview, broken down. Totals come from the server and match the Overview for the same dates and branch."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDefsOpen(true)}
              leadingIcon={<BookOpen aria-hidden="true" className="size-4" />}
            >
              Definitions
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.print()}
              leadingIcon={<Printer aria-hidden="true" className="size-4" />}
            >
              Print
            </Button>
            {canExport ? (
              <Button
                asChild
                size="sm"
                leadingIcon={<Download aria-hidden="true" className="size-4" />}
              >
                <a href={csvHref} download data-testid="export-csv">
                  Export CSV
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <ReportFilterBar
        filters={filters}
        onPreset={setPreset}
        onCustom={setCustom}
        onBranch={setBranch}
        onGranularity={tab.kind === 'sales' ? setGranularity : undefined}
      />

      <div className="hidden print:block">
        <p className="text-lg font-semibold">
          {tab.label} report · {periodText} · {branchName}
        </p>
      </div>

      <Tabs value={tab.kind} onValueChange={setTab}>
        <TabsList aria-label="Report" className="print:hidden">
          {TABS.map((t) => (
            <TabsTrigger key={t.kind} value={t.kind}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab.kind} className="grid gap-3 pt-4">
          <p className="text-sm text-text-muted print:hidden">
            <span className="font-medium text-text">{periodText}</span> · {branchName}
          </p>
          <Panel
            params={params}
            page={page}
            onPage={(p) => update({ page: String(p) })}
            ordering={ordering}
            onOrdering={(o) => update({ ordering: o })}
            status={status}
            onStatus={(s) => update({ status: s })}
          />
        </TabsContent>
      </Tabs>

      <DefinitionsSheet open={defsOpen} onOpenChange={setDefsOpen} />
    </div>
  );
}

function DefinitionsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data, isPending, isError } = useReportDefinitions();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title="What the numbers mean"
        description="Definitions of every figure on the Overview and in reports"
        data-theme="admin"
        className="w-[min(32rem,100vw)]"
      >
        <div className="grid gap-4 p-5">
          <p className="text-sm text-text-muted">
            <strong className="text-text">Gross</strong> is item sales before discounts;{' '}
            <strong className="text-text">net</strong> subtracts discounts and refunds;{' '}
            <strong className="text-text">collected</strong> is what customers actually paid,
            including delivery fees and tax, minus refunds. Definitions below are the exact rules
            the server uses.
          </p>
          {isPending ? (
            <div className="grid gap-3" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : isError || !data ? (
            <p role="alert" className="text-sm text-danger">
              Definitions could not be loaded. Try again in a moment.
            </p>
          ) : (
            <dl className="grid gap-4">
              {data.map((d) => (
                <div key={d.key}>
                  <dt className="text-sm font-semibold">{d.label}</dt>
                  <dd className="mt-0.5 text-sm text-text-muted">{d.definition}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
