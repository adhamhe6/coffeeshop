import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List filters live in the URL (shareable, survives reload, back button works).
 * `set` merges a patch, drops empty values and resets `page` unless the patch itself sets it.
 */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const get = useCallback((key: string) => params.get(key) ?? '', [params]);
  const set = useCallback(
    (patch: Record<string, string | number | boolean | null | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '' || v === false) next.delete(k);
            else next.set(k, String(v));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { params, get, set, page };
}
