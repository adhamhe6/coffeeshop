import { useEffect, useState } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

/**
 * Text box whose committed value lives in the URL. Typing updates the box immediately and the URL after a short pause;
 * when the URL changes from elsewhere (Back, "Clear filters") the box follows. A stale debounced value never overwrites that.
 */
export function useUrlSearchInput(urlValue: string, commit: (value: string) => void, delay = 300) {
  const [text, setText] = useState(urlValue);
  const [prevUrl, setPrevUrl] = useState(urlValue);
  if (urlValue !== prevUrl) {
    setPrevUrl(urlValue);
    setText(urlValue);
  }
  const debounced = useDebouncedValue(text.trim(), delay);
  useEffect(() => {
    if (debounced === text.trim() && debounced !== urlValue) commit(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the settled text
  }, [debounced, text]);
  return [text, setText] as const;
}
