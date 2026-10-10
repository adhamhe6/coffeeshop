import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { ListParams } from '@/lib/api/peopleKeys';

/**
 * List-page state kept in the URL (shareable, survives reload / back button): `page`, `search`, `ordering` plus
 * any extra filter keys. Changing anything but `page` resets to page 1.
 */
export function useListState(filterKeys: readonly string[] = [], defaults: ListParams = {}) {
  const [sp, setSp] = useSearchParams();

  const params: ListParams = { ...defaults };
  const page = Number(sp.get('page'));
  params.page = Number.isInteger(page) && page > 0 ? page : 1;
  const search = sp.get('search');
  if (search) params.search = search;
  const ordering = sp.get('ordering');
  if (ordering) params.ordering = ordering;
  for (const k of filterKeys) {
    const v = sp.get(k);
    if (v !== null && v !== '') params[k] = v;
  }

  const update = useCallback(
    (patch: Record<string, string | number | undefined | null>, resetPage = true) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  const setPage = useCallback(
    (page: number) => update({ page: page <= 1 ? undefined : page }, false),
    [update],
  );

  return { params, update, setPage };
}

/** Search box state: instant typing, debounced write to the URL. */
export function useDebouncedSearch(value: string, onCommit: (v: string) => void, delay = 300) {
  const [text, setText] = useState(value);
  // Adopt URL changes made elsewhere (clear filters, back button) without an effect.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const debounced = useDebouncedValue(text, delay);
  useEffect(() => {
    if (debounced !== value && debounced === text) onCommit(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return [text, setText] as const;
}
