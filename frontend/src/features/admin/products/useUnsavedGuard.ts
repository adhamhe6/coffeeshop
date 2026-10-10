import { useEffect } from 'react';
import { useBlocker } from 'react-router';

/**
 * Warn before losing edits: blocks in-app navigation (returns the blocker so the page can show its own dialog) and
 * asks the browser to confirm reload / tab close.
 */
export function useUnsavedGuard(dirty: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname + currentLocation.search !==
        nextLocation.pathname + nextLocation.search,
  );
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return blocker;
}
