import { useCallback, useSyncExternalStore } from 'react';
import { useSelectedBranch } from '@/features/catalog';
import type { OrderType } from '@/lib/api/orders';

/**
 * The customer's fulfilment choice for cart and checkout: pickup vs delivery and the branch come from the
 * storefront-wide `useSelectedBranch()` (so the header selector, the menu and checkout always agree); the applied
 * promo code is kept here for the browser session.
 */
const COUPON_KEY = 'lantern.checkout.coupon';
const listeners = new Set<() => void>();
let coupon: string | null = null;

function readCoupon(): string {
  if (coupon !== null) return coupon;
  try {
    coupon = window.sessionStorage.getItem(COUPON_KEY) ?? '';
  } catch {
    coupon = '';
  }
  return coupon;
}

function writeCoupon(next: string) {
  coupon = next;
  try {
    if (next) window.sessionStorage.setItem(COUPON_KEY, next);
    else window.sessionStorage.removeItem(COUPON_KEY);
  } catch {
    // in-memory value still works
  }
  listeners.forEach((l) => l());
}

export function resetSelectionForTests() {
  coupon = null;
  listeners.forEach((l) => l());
}

export function useCheckoutSelection() {
  const selected = useSelectedBranch();
  const couponCode = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    readCoupon,
    () => '',
  );
  const { setBranch, setOrderType: setType } = selected;
  const setOrderType = useCallback(
    (type: OrderType) => setType(type === 'DELIVERY' ? 'delivery' : 'pickup'),
    [setType],
  );
  const setBranchSlug = useCallback(
    (slug: string | null) => {
      if (slug) setBranch(slug);
    },
    [setBranch],
  );
  return {
    orderType: (selected.orderType === 'delivery' ? 'DELIVERY' : 'PICKUP') as OrderType,
    branchSlug: selected.branchSlug ?? null,
    couponCode,
    setOrderType,
    setBranchSlug,
    setCouponCode: writeCoupon,
  };
}
