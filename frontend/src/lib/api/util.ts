import type { Paginated } from './types';

/** Accept `[...]`, DRF pagination, or `{ results }` and return the array. */
export function unwrapList<T>(
  data: T[] | Paginated<T> | { results?: T[] } | null | undefined,
): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}
