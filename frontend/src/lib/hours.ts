import type { Branch } from './api/types';

/** "07:30:00" → "7:30 am", "18:00:00" → "6 pm". */
export function formatClock(time: string | null | undefined): string {
  if (!time) return '';
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const m = Number(mStr ?? 0);
  if (Number.isNaN(h)) return time;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')} ${suffix}` : `${hour12} ${suffix}`;
}

export function formatRange(opens: string | null, closes: string | null): string {
  return opens && closes ? `${formatClock(opens)} – ${formatClock(closes)}` : 'Closed';
}

/** Today's opening text for a branch; prefers the API's pre-formatted `today_hours`. */
export function todayHoursText(branch: Branch): string {
  if (branch.today_hours)
    return branch.today_hours.is_closed ? 'Closed today' : branch.today_hours.text;
  const tz = branch.timezone ?? 'UTC';
  let weekday: number;
  try {
    const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(
      new Date(),
    );
    weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name);
  } catch {
    weekday = (new Date().getDay() + 6) % 7;
  }
  const day = branch.hours?.find((h) => h.weekday === weekday);
  if (!day || day.is_closed) return 'Closed today';
  return formatRange(day.opens, day.closes);
}
