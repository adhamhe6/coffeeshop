import type { HoursEntry } from '@/lib/api/adminBranches';

export const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** Editing model: times as "HH:MM" (what `<input type="time">` produces). */
export interface DayHours {
  weekday: number;
  is_closed: boolean;
  opens: string;
  closes: string;
}

const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** Seven rows, Monday first. Days the API did not return count as closed. */
export function fromApi(entries: HoursEntry[]): DayHours[] {
  return DAYS.map((_, weekday) => {
    const e = entries.find((x) => x.weekday === weekday);
    return {
      weekday,
      is_closed: e ? e.is_closed || !e.opens || !e.closes : true,
      opens: hm(e?.opens),
      closes: hm(e?.closes),
    };
  });
}

/** Error text for one day, or null. Same rule as the server: closing must be after opening (no overnight hours). */
export function validateDay(d: DayHours): string | null {
  if (d.is_closed) return null;
  if (!d.opens || !d.closes) return 'Set both opening and closing times, or mark the day closed.';
  if (d.closes <= d.opens) return 'Closing time must be after opening time.';
  return null;
}

export function validateWeek(days: DayHours[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const d of days) {
    const problem = validateDay(d);
    if (problem) out[d.weekday] = problem;
  }
  return out;
}

/** Copy `from`'s hours (or closed state) onto the listed weekdays (default: every other day). */
export function copyDay(days: DayHours[], from: number, to?: number[]): DayHours[] {
  const source = days.find((d) => d.weekday === from);
  if (!source) return days;
  return days.map((d) =>
    d.weekday === from || (to && !to.includes(d.weekday))
      ? d
      : { ...d, is_closed: source.is_closed, opens: source.opens, closes: source.closes },
  );
}

export function toRequest(days: DayHours[]): HoursEntry[] {
  return days.map((d) => ({
    weekday: d.weekday,
    is_closed: d.is_closed,
    opens: d.is_closed ? null : d.opens,
    closes: d.is_closed ? null : d.closes,
  }));
}

export function sameHours(a: DayHours[], b: DayHours[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
