import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { Granularity, ReportParams } from '@/lib/api/adminReports';
import {
  DEFAULT_PRESET,
  RANGE_PRESETS,
  resolvePreset,
  validateCustomRange,
  type RangePreset,
} from './dateRange';

export interface ReportFilters {
  preset: RangePreset;
  /** Custom inputs as typed (may be incomplete/invalid). */
  customFrom: string;
  customTo: string;
  customError: string | null;
  branch: string;
  granularity: Granularity;
  /** What to send to the API (an invalid custom range falls back to the default preset). */
  params: ReportParams;
}

const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

/**
 * Date range + branch + granularity, kept in the URL (`?range=7d&branch=2&gran=week`) so a view can be shared,
 * reloaded or navigated back to. `extraKeys` are params this hook leaves alone when it changes a filter.
 */
export function useReportFilters(defaultPreset: RangePreset = DEFAULT_PRESET) {
  const [search, setSearch] = useSearchParams();
  const rawRange = search.get('range');
  const preset = (RANGE_PRESETS.find((p) => p.value === rawRange)?.value ??
    defaultPreset) as RangePreset;
  const customFrom = search.get('from') ?? '';
  const customTo = search.get('to') ?? '';
  const branch = search.get('branch') ?? '';
  const rawGran = search.get('gran');
  const granularity = (GRANULARITIES.find((g) => g === rawGran) ?? 'day') as Granularity;

  const filters = useMemo<ReportFilters>(() => {
    const customError = preset === 'custom' ? validateCustomRange(customFrom, customTo) : null;
    const range =
      preset === 'custom' && customError
        ? resolvePreset(defaultPreset)
        : resolvePreset(preset, { from: customFrom, to: customTo });
    return {
      preset,
      customFrom,
      customTo,
      customError,
      branch,
      granularity,
      params: {
        ...range,
        branch: branch || undefined,
        granularity,
      },
    };
  }, [preset, customFrom, customTo, branch, granularity, defaultPreset]);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') next.delete(k);
            else next.set(k, v);
          }
          // Any filter change restarts pagination.
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );

  return {
    filters,
    setPreset: (p: RangePreset) =>
      update({
        range: p === defaultPreset ? null : p,
        ...(p === 'custom' ? {} : { from: null, to: null }),
      }),
    setCustom: (from: string, to: string) => update({ range: 'custom', from, to }),
    setBranch: (id: string) => update({ branch: id || null }),
    setGranularity: (g: Granularity) => update({ gran: g === 'day' ? null : g }),
    update,
    search,
  };
}
