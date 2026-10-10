import { useBranches } from '@/lib/api/branches';
import { isValidTimeZone } from './datetime';

/**
 * The store's timezone for scheduling forms. The public API does not expose a single store zone, so we use the
 * first branch's IANA zone (the seed uses one zone for all branches) and fall back to the browser's.
 */
export function useStoreTimeZone(): {
  timeZone: string;
  source: 'branch' | 'browser';
  label: string;
} {
  const branches = useBranches();
  const tz = branches.data?.find((b) => isValidTimeZone(b.timezone))?.timezone;
  if (tz) return { timeZone: tz, source: 'branch', label: tz.replace(/_/g, ' ') };
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return { timeZone: browser, source: 'browser', label: browser.replace(/_/g, ' ') };
}
