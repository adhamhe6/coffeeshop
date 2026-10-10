import type { Branch } from '@/lib/api/types';

/** Monday = 0 … Sunday = 6, in the branch's own timezone. */
export function todayWeekday(timezone: string | undefined, now = new Date()): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: timezone || 'UTC',
    }).format(now);
    const i = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name);
    if (i >= 0) return i;
  } catch {
    /* unknown timezone: fall through */
  }
  return (now.getDay() + 6) % 7;
}

/** "Opens Mon, 6:30 AM" from the API's `next_open_at`, rendered in the branch timezone. */
export function nextOpenText(branch: Branch): string | null {
  if (!branch.next_open_at) return null;
  const when = new Date(branch.next_open_at);
  if (Number.isNaN(when.getTime())) return null;
  try {
    return `Opens ${new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: branch.timezone || 'UTC',
    }).format(when)}`;
  } catch {
    return null;
  }
}
