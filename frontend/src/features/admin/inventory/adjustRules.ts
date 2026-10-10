import type { AdjustStockInput, ManualMovementType } from '@/lib/api/adminInventory';

/**
 * Client-side mirror of the server's stock adjustment rules (`inventory.services.adjust_stock`), used to give instant
 * feedback and to preview the resulting quantity. The server stays the authority and may still refuse (409).
 *
 *  - RECEIPT adds stock, WASTE removes it, ADJUSTMENT may do either or set an absolute counted quantity.
 *  - ADJUSTMENT and WASTE need a reason.
 *  - The result can never be below zero and must differ from the current quantity.
 */
export type AdjustMode = 'change' | 'set';

export interface AdjustDraft {
  type: ManualMovementType;
  mode: AdjustMode;
  /** What the person typed (string so partial input is representable). */
  quantity: string;
  reason: string;
  reference: string;
}

export interface AdjustOutcome {
  /** Request fields for `delta` / `set_to`, absent while the draft is invalid. */
  quantityFields?: Pick<AdjustStockInput, 'delta' | 'set_to'>;
  resulting?: number;
  errors: { quantity?: string; reason?: string; reference?: string };
}

export const REASON_REQUIRED: ReadonlySet<ManualMovementType> = new Set(['ADJUSTMENT', 'WASTE']);

export function evaluateAdjustment(draft: AdjustDraft, current: number): AdjustOutcome {
  const errors: AdjustOutcome['errors'] = {};
  const raw = draft.quantity.trim();
  const mode: AdjustMode = draft.type === 'ADJUSTMENT' ? draft.mode : 'change';
  let quantityFields: AdjustOutcome['quantityFields'];
  let resulting: number | undefined;

  if (raw === '') {
    errors.quantity = 'Enter a quantity.';
  } else if (!/^[+-]?\d+$/.test(raw)) {
    errors.quantity = 'Use a whole number.';
  } else {
    const n = Number(raw);
    if (mode === 'set') {
      if (n < 0) errors.quantity = 'The counted quantity cannot be negative.';
      else if (n === current) errors.quantity = 'That is already the current quantity.';
      else {
        quantityFields = { set_to: n };
        resulting = n;
      }
    } else if (draft.type === 'RECEIPT') {
      if (n <= 0) errors.quantity = 'Enter how many units were received (more than 0).';
      else {
        quantityFields = { delta: n };
        resulting = current + n;
      }
    } else if (draft.type === 'WASTE') {
      if (n <= 0) errors.quantity = 'Enter how many units were wasted (more than 0).';
      else if (n > current) errors.quantity = `Only ${current} in stock; you cannot remove ${n}.`;
      else {
        quantityFields = { delta: -n };
        resulting = current - n;
      }
    } else {
      // ADJUSTMENT, signed change
      if (n === 0) errors.quantity = 'That does not change the stock level.';
      else if (current + n < 0)
        errors.quantity = `Only ${current} in stock; you cannot remove ${-n}.`;
      else {
        quantityFields = { delta: n };
        resulting = current + n;
      }
    }
  }

  if (REASON_REQUIRED.has(draft.type) && draft.reason.trim() === '') {
    errors.reason = 'A reason is required for adjustments and waste.';
  }
  if (draft.reason.length > 200) errors.reason = 'Keep the reason under 200 characters.';
  if (draft.reference.length > 60) errors.reference = 'Keep the reference under 60 characters.';

  return {
    quantityFields: Object.keys(errors).length ? undefined : quantityFields,
    resulting,
    errors,
  };
}

/** Request body for `POST admin/inventory/adjust/`; only valid when `evaluateAdjustment` had no errors. */
export function buildAdjustRequest(
  branch: number,
  product: number,
  draft: AdjustDraft,
  outcome: AdjustOutcome,
): AdjustStockInput | null {
  if (!outcome.quantityFields) return null;
  return {
    branch,
    product,
    movement_type: draft.type,
    ...outcome.quantityFields,
    reason: draft.reason.trim(),
    reference: draft.reference.trim(),
  };
}
