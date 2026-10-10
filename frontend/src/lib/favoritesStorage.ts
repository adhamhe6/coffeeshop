/**
 * Anonymous favourites live in localStorage as a JSON array of product ids.
 * Every access is wrapped: storage can throw (private mode, blocked cookies, quota) and must never break the UI.
 * After login/registration `mergeLocalFavorites` pushes them to `favorites/merge/` and clears the local copy.
 */
export const FAVORITES_KEY = 'lantern.favorites.v1';
const EVENT = 'lantern:favorites-changed';

function safeParse(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((v): v is number => Number.isInteger(v) && v > 0))];
  } catch {
    return [];
  }
}

// In-memory mirror so the UI keeps working when storage is unavailable.
let memory: number[] | null = null;
let snapshot: readonly number[] = [];
let snapshotKey = '';

export function readLocalFavorites(): number[] {
  try {
    const stored = safeParse(window.localStorage.getItem(FAVORITES_KEY));
    memory = stored;
    return stored;
  } catch {
    return memory ?? [];
  }
}

function emit() {
  window.dispatchEvent(new Event(EVENT));
}

export function writeLocalFavorites(ids: number[]): void {
  const unique = [...new Set(ids)];
  memory = unique;
  try {
    if (unique.length) window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(unique));
    else window.localStorage.removeItem(FAVORITES_KEY);
  } catch {
    /* storage unavailable: keep the in-memory copy for this session */
  }
  emit();
}

export function toggleLocalFavorite(id: number): boolean {
  const current = readLocalFavorites();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  writeLocalFavorites(next);
  return next.includes(id);
}

export function clearLocalFavorites(): void {
  writeLocalFavorites([]);
}

/** Stable snapshot for `useSyncExternalStore` (same reference until the content changes). */
export function getLocalFavoritesSnapshot(): readonly number[] {
  const current = readLocalFavorites();
  const key = current.join(',');
  if (key !== snapshotKey) {
    snapshotKey = key;
    snapshot = current;
  }
  return snapshot;
}

export function subscribeLocalFavorites(notify: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === FAVORITES_KEY) notify();
  };
  window.addEventListener(EVENT, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener('storage', onStorage);
  };
}

/** Test helper: forget the in-memory mirror. */
export function resetFavoritesMemoryForTests() {
  memory = null;
  snapshot = [];
  snapshotKey = '';
}
