import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, Field, Input, Select } from '@/design';
import { useBranchOptions, type Granularity } from '@/lib/api/adminReports';
import { RANGE_PRESETS, type RangePreset } from './dateRange';
import { Segmented } from './Segmented';
import type { ReportFilters } from './useReportFilters';

const ALL = 'all';

export function BranchSelect({
  value,
  onChange,
  className,
  label = 'Branch',
  hideLabel = true,
}: {
  value: string;
  onChange: (id: string) => void;
  className?: string;
  label?: string;
  hideLabel?: boolean;
}) {
  const { data: branches } = useBranchOptions();
  const { staff } = useAuth();
  // A single-branch scope has nothing to choose: the topbar already names the branch.
  if (!branches || branches.length < 2) return null;
  return (
    <Field label={label} hideLabel={hideLabel} className={className}>
      <Select
        size="sm"
        value={value || ALL}
        onValueChange={(v) => onChange(v === ALL ? '' : v)}
        options={[
          { value: ALL, label: staff?.branch_ids ? 'All my branches' : 'All branches' },
          ...branches.map((b) => ({ value: String(b.id), label: b.name })),
        ]}
        className="min-w-44 max-md:h-11"
        aria-label={label}
      />
    </Field>
  );
}

interface DateRangeFilterProps {
  filters: ReportFilters;
  onPreset: (preset: RangePreset) => void;
  onCustom: (from: string, to: string) => void;
}

export function DateRangeFilter({ filters, onPreset, onCustom }: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Segmented
        label="Date range"
        value={filters.preset}
        options={RANGE_PRESETS}
        onChange={(p) => {
          if (p === 'custom') {
            // Seed the custom inputs with the range currently shown so the first apply is a no-op.
            onCustom(filters.params.date_from ?? '', filters.params.date_to ?? '');
          } else onPreset(p);
        }}
      />
      {filters.preset === 'custom' ? (
        <CustomRangeForm
          key={`${filters.customFrom}|${filters.customTo}`}
          initialFrom={filters.customFrom}
          initialTo={filters.customTo}
          error={filters.customError}
          onApply={onCustom}
        />
      ) : null}
    </div>
  );
}

/** Typed values are only committed (to the URL and the API) on "Apply", so half-typed dates never fire requests. */
function CustomRangeForm({
  initialFrom,
  initialTo,
  error,
  onApply,
}: {
  initialFrom: string;
  initialTo: string;
  error: string | null;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(from, to);
      }}
      aria-label="Custom date range"
    >
      <Field label="From" error={error ?? undefined}>
        <Input
          type="date"
          size="sm"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40 max-md:h-11"
        />
      </Field>
      <Field label="To">
        <Input
          type="date"
          size="sm"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="w-40 max-md:h-11"
        />
      </Field>
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        leadingIcon={<CalendarRange aria-hidden="true" className="size-4" />}
      >
        Apply
      </Button>
    </form>
  );
}

export const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

interface ReportFilterBarProps extends DateRangeFilterProps {
  onBranch: (id: string) => void;
  onGranularity?: (g: Granularity) => void;
  /** Extra controls placed at the end of the bar (export, print…). */
  actions?: React.ReactNode;
}

/** Date range + branch (+ optional granularity). One row above the data, shared by overview and reports. */
export function ReportFilterBar({
  filters,
  onPreset,
  onCustom,
  onBranch,
  onGranularity,
  actions,
}: ReportFilterBarProps) {
  return (
    <div
      role="group"
      aria-label="Report filters"
      className="flex flex-wrap items-end gap-x-3 gap-y-2 print:hidden"
    >
      <DateRangeFilter filters={filters} onPreset={onPreset} onCustom={onCustom} />
      <BranchSelect value={filters.branch} onChange={onBranch} />
      {onGranularity ? (
        <Segmented
          label="Group by"
          value={filters.granularity}
          options={GRANULARITY_OPTIONS}
          onChange={onGranularity}
        />
      ) : null}
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
