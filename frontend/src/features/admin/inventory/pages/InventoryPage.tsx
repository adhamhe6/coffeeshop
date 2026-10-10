import { Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/app/auth';
import {
  Button,
  ErrorState,
  Money,
  Select,
  Stat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useBranchOptions } from '@/lib/api/adminBranches';
import { useInventorySummary } from '@/lib/api/adminInventory';
import { PageHeader } from '../../catalog-kit/PageHeader';
import { useUrlState } from '../../catalog-kit/useUrlState';
import { AdjustStockDialog } from '../components/AdjustStockDialog';
import { AvailabilityTab } from '../components/AvailabilityTab';
import { MovementsTab } from '../components/MovementsTab';
import { StockTab } from '../components/StockTab';

const ALL = 'all';

export default function AdminInventoryPage() {
  useSeo({ title: 'Inventory · Admin', noindex: true });
  const { hasCapability } = useAuth();
  const canManage = hasCapability('inventory.manage');
  const { get, set } = useUrlState();
  const branches = useBranchOptions();
  const [adjusting, setAdjusting] = useState(false);

  const tab = get('tab') || 'stock';
  const options = branches.data ?? [];
  // Availability is per branch, so it always needs one; the other tabs may show all of the person's branches.
  const urlBranch = get('branch');
  const effectiveBranch =
    urlBranch && options.some((b) => String(b.id) === urlBranch)
      ? urlBranch
      : tab === 'availability' && options[0]
        ? String(options[0].id)
        : '';
  const branchName = options.find((b) => String(b.id) === effectiveBranch)?.name ?? '';
  const summary = useInventorySummary(effectiveBranch || undefined);

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock levels, movements and daily availability for the branches you manage."
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setAdjusting(true)}
            >
              Adjust stock
            </Button>
          ) : null
        }
      />

      {options.length > 1 ? (
        <div className="mb-4 max-w-xs">
          <Select
            size="sm"
            aria-label="Branch"
            value={effectiveBranch || ALL}
            onValueChange={(v) => set({ branch: v === ALL ? null : v })}
            options={[
              ...(tab === 'availability' ? [] : [{ value: ALL, label: 'All my branches' }]),
              ...options.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
          />
        </div>
      ) : null}

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          {summary.data && summary.data.low_stock_count > 0 ? (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-warning"
            >
              <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
              <p className="mr-auto text-sm font-medium">
                {summary.data.low_stock_count} item
                {summary.data.low_stock_count === 1 ? ' is' : 's are'} at or below the low-stock
                alert level
                {summary.data.out_of_stock_count > 0
                  ? `, ${summary.data.out_of_stock_count} out of stock`
                  : ''}
                .
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => set({ tab: null, low: '1', out: null })}
              >
                Show low stock
              </Button>
            </div>
          ) : null}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Tracked items"
              value={summary.data?.tracked_items ?? 0}
              loading={summary.isPending}
            />
            <Stat
              label="Low stock"
              value={summary.data?.low_stock_count ?? 0}
              loading={summary.isPending}
              hint="At or below alert level"
            />
            <Stat
              label="Out of stock"
              value={summary.data?.out_of_stock_count ?? 0}
              loading={summary.isPending}
            />
            <Stat
              label="Stock value"
              value={<Money value={summary.data?.valuation} />}
              loading={summary.isPending}
              hint={
                summary.data && summary.data.unvalued_items > 0
                  ? `${summary.data.unvalued_items} item${summary.data.unvalued_items === 1 ? '' : 's'} without a unit cost not counted`
                  : 'Quantity × unit cost'
              }
            />
          </div>
        </>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) =>
          set({
            tab: v === 'stock' ? null : v,
            q: null,
            page: null,
            low: null,
            out: null,
            available: null,
          })
        }
      >
        <TabsList aria-label="Inventory views">
          <TabsTrigger value="stock">Stock levels</TabsTrigger>
          <TabsTrigger value="movements">Movement history</TabsTrigger>
          <TabsTrigger value="availability">Daily availability</TabsTrigger>
        </TabsList>
        <TabsContent value="stock">
          <StockTab branch={effectiveBranch} canManage={canManage} />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab branch={effectiveBranch} />
        </TabsContent>
        <TabsContent value="availability">
          <AvailabilityTab
            branchId={effectiveBranch ? Number(effectiveBranch) : null}
            branchName={branchName}
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>

      {adjusting ? (
        <AdjustStockDialog
          target={{ branchId: effectiveBranch ? Number(effectiveBranch) : undefined }}
          onClose={() => setAdjusting(false)}
        />
      ) : null}
    </div>
  );
}
