/**
 * Date helpers for admin forms. Staff think in the *store's* timezone, not the browser's, so `datetime-local`
 * inputs are converted to/from UTC ISO strings using an IANA zone (Intl only, no extra dependency).
 */

function parts(ts: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** Offset (ms) of `timeZone` from UTC at instant `ts`. */
function zoneOffset(ts: number, timeZone: string): number {
  const p = parts(ts, timeZone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000
  );
}

export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** ISO instant → `YYYY-MM-DDTHH:mm` wall-clock time in `timeZone` (value for `<input type="datetime-local">`). */
export function isoToZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const p = parts(ts, timeZone);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `YYYY-MM-DDTHH:mm` wall-clock time in `timeZone` → UTC ISO string (`null` for blank/invalid). */
export function zonedInputToIso(local: string | null | undefined, timeZone: string): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const wall = Date.UTC(y as number, (mo as number) - 1, d as number, h as number, mi as number);
  // Two passes settle DST transitions: guess with the offset at the wall time, then re-check at the result.
  let ts = wall - zoneOffset(wall, timeZone);
  ts = wall - zoneOffset(ts, timeZone);
  return new Date(ts).toISOString();
}

export function formatDateTime(
  iso: string | null | undefined,
  opts: { timeZone?: string; withTime?: boolean } = {},
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const { timeZone, withTime = true } = opts;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : undefined,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(d);
}

export const formatDate = (iso: string | null | undefined, timeZone?: string) =>
  formatDateTime(iso, { timeZone, withTime: false });

/** "3 days ago" / "in 2 hours" for compact tables; falls back to the date for old values. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '—';
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const min = 60_000;
  if (abs < min) return 'just now';
  if (abs < 60 * min) return rtf.format(Math.round(diff / min), 'minute');
  if (abs < 24 * 60 * min) return rtf.format(Math.round(diff / (60 * min)), 'hour');
  if (abs < 30 * 24 * 60 * min) return rtf.format(Math.round(diff / (24 * 60 * min)), 'day');
  return formatDate(iso);
}
