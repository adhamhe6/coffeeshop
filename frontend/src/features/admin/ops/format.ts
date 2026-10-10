import { format, parseISO } from 'date-fns';

/** `95` → `1 h 35 min`, `4` → `4 min`, `1500` → `1 d 1 h`. Ages are shown, never computed from the clock client-side. */
export function formatAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const hours = h % 24;
  return hours ? `${d} d ${hours} h` : `${d} d`;
}

export const formatInt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(n);

export const formatPct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`;

/** `2026-10-10T21:27:42Z` → `Oct 10, 2026, 5:27 PM` in the viewer's time zone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'MMM d, yyyy, h:mm a');
  } catch {
    return iso;
  }
}

/** `Oct 10, 9:27 PM`, with the year only when it is not the current one. */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = parseISO(iso);
    return format(
      d,
      d.getFullYear() === new Date().getFullYear() ? 'MMM d, h:mm a' : 'MMM d, yyyy, h:mm a',
    );
  } catch {
    return iso;
  }
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'h:mm a');
  } catch {
    return iso;
  }
}

/** Calendar day `2026-10-10` → `Oct 10`. (Date-only strings are parsed as local days, never shifted by a time zone.) */
export function formatDay(day: string, withYear = false): string {
  try {
    return format(parseISO(day), withYear ? 'MMM d, yyyy' : 'MMM d');
  } catch {
    return day;
  }
}

export function humanise(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}
