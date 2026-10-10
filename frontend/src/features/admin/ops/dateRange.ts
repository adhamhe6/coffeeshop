import { addDays, endOfMonth, format, startOfMonth, subDays } from 'date-fns';

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

export const DEFAULT_PRESET: RangePreset = '30d';
export const MAX_RANGE_DAYS = 400;

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export interface ResolvedRange {
  date_from: string;
  date_to: string;
}

/**
 * Preset → inclusive `[date_from, date_to]` day range. Dates are the viewer's calendar days; the API evaluates them as
 * branch-local days (the period it returns says which time zone).
 */
export function resolvePreset(
  preset: RangePreset,
  custom: { from?: string | null; to?: string | null } = {},
  now: Date = new Date(),
): ResolvedRange {
  const today = iso(now);
  switch (preset) {
    case 'today':
      return { date_from: today, date_to: today };
    case '7d':
      return { date_from: iso(subDays(now, 6)), date_to: today };
    case 'month': {
      const to = now < endOfMonth(now) ? now : endOfMonth(now);
      return { date_from: iso(startOfMonth(now)), date_to: iso(to) };
    }
    case 'custom': {
      const from = custom.from || iso(subDays(now, 29));
      const to = custom.to || today;
      return from <= to ? { date_from: from, date_to: to } : { date_from: to, date_to: from };
    }
    case '30d':
    default:
      return { date_from: iso(subDays(now, 29)), date_to: today };
  }
}

export function rangeDays(r: ResolvedRange): number {
  const a = new Date(`${r.date_from}T00:00:00`);
  const b = new Date(`${r.date_to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** Custom range is valid when both days are set, ordered and within the API's maximum span. */
export function validateCustomRange(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both a start and an end date.';
  if (from > to) return 'The start date must be on or before the end date.';
  if (rangeDays({ date_from: from, date_to: to }) > MAX_RANGE_DAYS)
    return `Choose a range of at most ${MAX_RANGE_DAYS} days.`;
  return null;
}

export const shiftDay = (day: string, by: number) => iso(addDays(new Date(`${day}T00:00:00`), by));
