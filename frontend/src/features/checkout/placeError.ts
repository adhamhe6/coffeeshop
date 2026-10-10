import { isApiError } from '@/lib/api/errors';
import type { CartPreview } from '@/lib/api/checkout';

export type StepId = 'type' | 'branch' | 'address' | 'time' | 'coupon' | 'payment' | 'details';
/** Where an error message is rendered: a whole step, or one field of the details step. */
export type ErrorSlot = StepId | 'phone' | 'terms' | 'notes';

export interface StockShortage {
  product_id?: number;
  name: string;
  requested?: number;
  available?: number;
}

export type PlaceError =
  | { kind: 'network'; message: string }
  | { kind: 'auth'; message: string }
  | { kind: 'price_changed'; message: string; preview: CartPreview | null }
  | { kind: 'out_of_stock'; message: string; items: StockShortage[] }
  | { kind: 'cart_empty'; message: string }
  | {
      kind: 'step';
      /** Where the customer can fix it. */
      step: StepId;
      message: string;
      fields: Partial<Record<ErrorSlot, string>>;
      code: string;
    }
  | { kind: 'generic'; message: string; code: string; requestId?: string };

const FIELD_SLOT: Record<string, ErrorSlot> = {
  order_type: 'type',
  branch_id: 'branch',
  address_id: 'address',
  requested_for: 'time',
  coupon_code: 'coupon',
  payment_method: 'payment',
  customer_notes: 'notes',
  phone: 'phone',
  accept_terms: 'terms',
};
const slotStep = (slot: ErrorSlot): StepId =>
  slot === 'phone' || slot === 'terms' || slot === 'notes' ? 'details' : slot;

const CODE_STEP: Record<string, StepId> = {
  branch_closed: 'branch',
  ordering_paused: 'branch',
  pickup_unavailable: 'branch',
  delivery_unavailable: 'branch',
  branch_required: 'branch',
  slot_invalid: 'time',
  zone_not_served: 'address',
  below_delivery_minimum: 'address',
  address_required: 'address',
  payment_method_unavailable: 'payment',
  terms_not_accepted: 'details',
};

/** Turn a failed `checkout/` call into something the page can place next to the right step. */
export function classifyPlaceError(error: unknown): PlaceError {
  if (!isApiError(error)) {
    return { kind: 'generic', message: 'Something went wrong. Please try again.', code: 'unknown' };
  }
  if (error.isNetwork) {
    return {
      kind: 'network',
      message:
        'We could not reach the server, so we do not know whether your order was placed. Press "Place order" again: it is safe to retry and will never create two orders.',
    };
  }
  if (error.status === 401) {
    return { kind: 'auth', message: 'Your session has ended. Sign in again to place your order.' };
  }
  if (error.code === 'price_changed') {
    const preview = (error.extra.preview as CartPreview | undefined) ?? null;
    return { kind: 'price_changed', message: error.message, preview };
  }
  if (error.code === 'out_of_stock') {
    const items = Array.isArray(error.extra.items) ? (error.extra.items as StockShortage[]) : [];
    return { kind: 'out_of_stock', message: error.message, items };
  }
  if (error.code === 'cart_empty') return { kind: 'cart_empty', message: error.message };

  const fields: Partial<Record<ErrorSlot, string>> = {};
  let first: ErrorSlot | null = null;
  for (const [field, messages] of Object.entries(error.fields)) {
    const slot = FIELD_SLOT[field];
    if (!slot) continue;
    fields[slot] = [fields[slot], messages.join(' ')].filter(Boolean).join(' ');
    first ??= slot;
  }
  if (first) {
    return {
      kind: 'step',
      step: slotStep(first),
      message: error.message,
      fields,
      code: error.code,
    };
  }

  const step = CODE_STEP[error.code];
  if (step) {
    const slot: ErrorSlot = error.code === 'terms_not_accepted' ? 'terms' : step;
    return {
      kind: 'step',
      step,
      message: error.message,
      fields: { [slot]: error.message },
      code: error.code,
    };
  }
  return { kind: 'generic', message: error.message, code: error.code, requestId: error.requestId };
}

/** Which step a server issue belongs to (`null` = the cart/items as a whole). */
export function stepForIssue(issue: {
  code: string;
  item_id?: number;
  data?: Record<string, unknown>;
}): StepId | null {
  if (issue.data?.field === 'coupon_code') return 'coupon';
  if (issue.item_id !== undefined) return null;
  return CODE_STEP[issue.code] ?? null;
}
