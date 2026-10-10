import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useBranches } from '@/lib/api/branches';
import type { Branch } from '@/lib/api/types';

/**
 * Selected branch + fulfilment preference, shared by the whole storefront (catalogue, cart, checkout).
 *
 * ```ts
 * const { branch, branchSlug, branchId, orderType, setBranch, setOrderType, branches, isReady } = useSelectedBranch();
 * ```
 *
 * - `branch`        the resolved `Branch` (stored choice, else the first branch accepting orders, else the first
 *                   branch); `null` until the branch list has loaded or when the store has no branches.
 * - `branchSlug`    `branch?.slug` — pass it as `?branch=` to catalogue endpoints (availability becomes branch-aware).
 * - `branchId`      `branch?.id` — for bodies that want the numeric id (`products/{slug}/quote/` → `branch_id`,
 *                   `cart/preview/`, checkout).
 * - `orderType`     `'pickup' | 'delivery'` preference, already coerced to what `branch` supports.
 * - `setBranch(slug)` / `setOrderType(type)`  persist the choice (localStorage, wrapped in try/catch; an in-memory
 *                   copy keeps working when storage is blocked). All consumers re-render, also across tabs.
 * - `isExplicit`    true when the visitor picked a branch themselves (not the default).
 * - `isReady`       false only while the first branch request is in flight. Catalogue queries wait for it so they do
 *                   not fire twice (without and with `branch=`).
 * - `branches`, `isLoading`, `isError`  the underlying `branches/` query.
 *
 * Works anywhere under `AppProviders`; no extra provider is required.
 */
export type OrderType = 'pickup' | 'delivery';

interface Stored {
  slug: string | null;
  orderType: OrderType;
}

export const BRANCH_KEY = 'lantern.branch.v1';
const EVENT = 'lantern:branch-changed';
const DEFAULT: Stored = { slug: null, orderType: 'pickup' };

let memory: Stored | null = null;
let snapshot: Stored = DEFAULT;
let snapshotKey = JSON.stringify(DEFAULT);

function parse(raw: string | null): Stored {
  if (!raw) return DEFAULT;
  try {
    const value = JSON.parse(raw) as Partial<Stored> | null;
    return {
      slug: typeof value?.slug === 'string' && value.slug ? value.slug : null,
      orderType: value?.orderType === 'delivery' ? 'delivery' : 'pickup',
    };
  } catch {
    return DEFAULT;
  }
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(BRANCH_KEY);
    // Nothing persisted but a choice made this session (writes were blocked): keep honouring it.
    if (raw === null && memory) return memory;
    const stored = parse(raw);
    memory = stored;
    return stored;
  } catch {
    return memory ?? DEFAULT;
  }
}

function write(next: Stored) {
  memory = next;
  try {
    window.localStorage.setItem(BRANCH_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the in-memory copy keeps this session consistent */
  }
  window.dispatchEvent(new Event(EVENT));
}

function getSnapshot(): Stored {
  const current = read();
  const key = JSON.stringify(current);
  if (key !== snapshotKey) {
    snapshotKey = key;
    snapshot = current;
  }
  return snapshot;
}

function subscribe(notify: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BRANCH_KEY) notify();
  };
  window.addEventListener(EVENT, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener('storage', onStorage);
  };
}

/** Test helper: forget the in-memory mirror. */
export function resetSelectedBranchForTests() {
  memory = null;
  snapshot = DEFAULT;
  snapshotKey = JSON.stringify(DEFAULT);
}

const EMPTY: Branch[] = [];

/** Which fulfilment methods a branch offers (`pickup_enabled` / `delivery_enabled`, default: pickup only). */
export function branchSupports(branch: Branch | null | undefined, type: OrderType): boolean {
  if (!branch) return type === 'pickup';
  return type === 'pickup' ? branch.pickup_enabled !== false : Boolean(branch.delivery_enabled);
}

export function useSelectedBranch() {
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT);
  const query = useBranches();
  const branches = query.data ?? EMPTY;

  const branch = useMemo<Branch | null>(() => {
    const chosen = stored.slug ? branches.find((b) => b.slug === stored.slug) : undefined;
    return chosen ?? branches.find((b) => b.accepting_orders !== false) ?? branches[0] ?? null;
  }, [branches, stored.slug]);

  const orderType = useMemo<OrderType>(() => {
    if (branchSupports(branch, stored.orderType)) return stored.orderType;
    return stored.orderType === 'pickup' ? 'delivery' : 'pickup';
  }, [branch, stored.orderType]);

  const setBranch = useCallback(
    (slug: string) => {
      const target = branches.find((b) => b.slug === slug);
      const current = getSnapshot();
      // Moving to a branch without delivery quietly falls back to pickup.
      const orderType =
        current.orderType === 'delivery' && target && !branchSupports(target, 'delivery')
          ? 'pickup'
          : current.orderType;
      write({ slug, orderType });
    },
    [branches],
  );

  const setOrderType = useCallback((type: OrderType) => {
    write({ ...getSnapshot(), orderType: type });
  }, []);

  return {
    branch,
    branchSlug: branch?.slug,
    branchId: branch?.id,
    orderType,
    setBranch,
    setOrderType,
    isExplicit: Boolean(stored.slug && branch && branch.slug === stored.slug),
    branches,
    isLoading: query.isPending,
    isError: query.isError,
    isReady: !query.isPending,
  };
}
