import { describe, expect, it } from 'vitest';
import { buildAdjustRequest, evaluateAdjustment, type AdjustDraft } from './adjustRules';

const draft = (d: Partial<AdjustDraft>): AdjustDraft => ({
  type: 'RECEIPT',
  mode: 'change',
  quantity: '',
  reason: '',
  reference: '',
  ...d,
});

describe('evaluateAdjustment', () => {
  it('receipt adds units and previews the result', () => {
    const o = evaluateAdjustment(draft({ type: 'RECEIPT', quantity: '12' }), 8);
    expect(o.errors).toEqual({});
    expect(o.quantityFields).toEqual({ delta: 12 });
    expect(o.resulting).toBe(20);
  });

  it('a receipt of zero or less is rejected, and a reason is optional', () => {
    expect(evaluateAdjustment(draft({ quantity: '0' }), 5).errors.quantity).toMatch(/more than 0/);
    expect(evaluateAdjustment(draft({ quantity: '-3' }), 5).errors.quantity).toMatch(/more than 0/);
    expect(evaluateAdjustment(draft({ quantity: '3' }), 5).errors.reason).toBeUndefined();
  });

  it('waste removes units, needs a reason and cannot exceed the stock', () => {
    const ok = evaluateAdjustment(draft({ type: 'WASTE', quantity: '3', reason: 'Expired' }), 8);
    expect(ok.quantityFields).toEqual({ delta: -3 });
    expect(ok.resulting).toBe(5);
    const noReason = evaluateAdjustment(draft({ type: 'WASTE', quantity: '3' }), 8);
    expect(noReason.errors.reason).toBe('A reason is required for adjustments and waste.');
    expect(noReason.quantityFields).toBeUndefined();
    expect(
      evaluateAdjustment(draft({ type: 'WASTE', quantity: '9', reason: 'x' }), 8).errors.quantity,
    ).toMatch(/Only 8 in stock/);
  });

  it('adjustment accepts a signed change but never goes below zero', () => {
    expect(
      evaluateAdjustment(draft({ type: 'ADJUSTMENT', quantity: '-2', reason: 'Recount' }), 5)
        .resulting,
    ).toBe(3);
    expect(
      evaluateAdjustment(draft({ type: 'ADJUSTMENT', quantity: '+4', reason: 'Recount' }), 5)
        .resulting,
    ).toBe(9);
    expect(
      evaluateAdjustment(draft({ type: 'ADJUSTMENT', quantity: '-6', reason: 'Recount' }), 5).errors
        .quantity,
    ).toMatch(/Only 5 in stock/);
    expect(
      evaluateAdjustment(draft({ type: 'ADJUSTMENT', quantity: '0', reason: 'Recount' }), 5).errors
        .quantity,
    ).toMatch(/does not change/);
  });

  it('set-to mode sends set_to and refuses a no-op or negative count', () => {
    const o = evaluateAdjustment(
      draft({ type: 'ADJUSTMENT', mode: 'set', quantity: '10', reason: 'Stock-take' }),
      5,
    );
    expect(o.quantityFields).toEqual({ set_to: 10 });
    expect(o.resulting).toBe(10);
    expect(
      evaluateAdjustment(draft({ type: 'ADJUSTMENT', mode: 'set', quantity: '5', reason: 'x' }), 5)
        .errors.quantity,
    ).toMatch(/already the current/);
    expect(
      evaluateAdjustment(draft({ type: 'ADJUSTMENT', mode: 'set', quantity: '-1', reason: 'x' }), 5)
        .errors.quantity,
    ).toMatch(/negative/);
  });

  it('rejects non-integers and blanks', () => {
    expect(evaluateAdjustment(draft({ quantity: '' }), 1).errors.quantity).toBe(
      'Enter a quantity.',
    );
    expect(evaluateAdjustment(draft({ quantity: '1.5' }), 1).errors.quantity).toBe(
      'Use a whole number.',
    );
  });
});

describe('buildAdjustRequest', () => {
  it('builds the API body with trimmed reason/reference', () => {
    const d = draft({ type: 'WASTE', quantity: '2', reason: ' Spilled ', reference: ' W-1 ' });
    const body = buildAdjustRequest(3, 61, d, evaluateAdjustment(d, 10));
    expect(body).toEqual({
      branch: 3,
      product: 61,
      movement_type: 'WASTE',
      delta: -2,
      reason: 'Spilled',
      reference: 'W-1',
    });
  });
  it('returns null while the draft is invalid', () => {
    const d = draft({ quantity: '' });
    expect(buildAdjustRequest(1, 1, d, evaluateAdjustment(d, 1))).toBeNull();
  });
});
