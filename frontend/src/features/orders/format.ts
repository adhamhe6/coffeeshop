/** Date/time helpers for orders. Times are shown in the branch's own timezone when the API gives one. */
export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return date.toLocaleString('en-US');
  }
}

export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone,
    }).format(date);
  } catch {
    return date.toLocaleDateString('en-US');
  }
}

export function formatTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return date.toLocaleTimeString('en-US');
  }
}
