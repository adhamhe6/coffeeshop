import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { CheckoutPayload } from '@/lib/api/checkout';
import { createBackoff } from '@/lib/polling';
import { attemptKeyFor, clearAttemptKey, fingerprintOf } from './idempotency';
import { resolvePaymentAction } from './paymentAction';
import { classifyPlaceError } from './placeError';

const ORIGIN = 'https://shop.example';

describe('resolvePaymentAction', () => {
  it('routes same-origin URLs (the sandbox page) inside the app, whatever host the backend uses', () => {
    expect(
      resolvePaymentAction({ type: 'redirect', url: `${ORIGIN}/pay/demo/demo_x?a=1` }, ORIGIN),
    ).toEqual({ kind: 'internal', to: '/pay/demo/demo_x?a=1' });
    expect(resolvePaymentAction({ type: 'redirect', url: '/pay/demo/demo_x' }, ORIGIN)).toEqual({
      kind: 'internal',
      to: '/pay/demo/demo_x',
    });
  });
  it('sends other https URLs (Stripe Checkout) to a full-page redirect', () => {
    expect(
      resolvePaymentAction(
        { type: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_1' },
        ORIGIN,
      ),
    ).toEqual({ kind: 'external', url: 'https://checkout.stripe.com/c/pay/cs_1' });
  });
  it('ignores dangerous or malformed targets and non-redirect actions', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      '//evil.example/x',
      'not a url',
    ]) {
      expect(resolvePaymentAction({ type: 'redirect', url }, ORIGIN)).toEqual({ kind: 'none' });
    }
    expect(resolvePaymentAction({ type: 'none' }, ORIGIN)).toEqual({ kind: 'none' });
    expect(resolvePaymentAction(null, ORIGIN)).toEqual({ kind: 'none' });
  });
});

describe('idempotency key per checkout attempt', () => {
  const payload: CheckoutPayload = {
    branch_id: 1,
    order_type: 'PICKUP',
    payment_method: 'demo',
    accept_terms: true,
    expected_total: '9.72',
    coupon_code: '',
  };
  beforeEach(() => {
    clearAttemptKey();
    window.sessionStorage.clear();
  });

  it('is reused for a retry of the same order, even when only the displayed total changed', () => {
    const first = attemptKeyFor(payload);
    expect(attemptKeyFor({ ...payload })).toBe(first);
    expect(attemptKeyFor({ ...payload, expected_total: '10.69' })).toBe(first);
  });
  it('survives a reload (sessionStorage) and changes when the order itself changes', () => {
    const first = attemptKeyFor(payload);
    expect(JSON.parse(window.sessionStorage.getItem('lantern.checkout.attempt') ?? '{}').key).toBe(
      first,
    );
    expect(attemptKeyFor({ ...payload, branch_id: 2 })).not.toBe(first);
  });
  it('is regenerated after clearing (success)', () => {
    const first = attemptKeyFor(payload);
    clearAttemptKey();
    expect(window.sessionStorage.getItem('lantern.checkout.attempt')).toBeNull();
    expect(attemptKeyFor(payload)).not.toBe(first);
  });
  it('fingerprint ignores key order and expected_total', () => {
    expect(fingerprintOf({ ...payload, expected_total: '1.00' })).toBe(fingerprintOf(payload));
  });
});

describe('classifyPlaceError', () => {
  const api = (status: number, code: string, fields: Record<string, string[]> = {}, extra = {}) =>
    new ApiError({ status, code, message: `msg ${code}`, fields, extra });

  it('recognises network failures, expiry, price changes and stock', () => {
    expect(classifyPlaceError(api(0, 'network_error')).kind).toBe('network');
    expect(classifyPlaceError(api(401, 'not_authenticated')).kind).toBe('auth');
    expect(
      classifyPlaceError(api(409, 'price_changed', {}, { preview: { total: '1.00' } })),
    ).toMatchObject({
      kind: 'price_changed',
      preview: { total: '1.00' },
    });
    expect(
      classifyPlaceError(api(409, 'out_of_stock', {}, { items: [{ name: 'Beans' }] })),
    ).toMatchObject({ kind: 'out_of_stock', items: [{ name: 'Beans' }] });
  });
  it('maps fields and codes to the step that can fix them', () => {
    expect(
      classifyPlaceError(
        api(400, 'validation_error', {
          address_id: ['Choose a delivery address.'],
          phone: ['Bad.'],
        }),
      ),
    ).toMatchObject({
      kind: 'step',
      step: 'address',
      fields: { address: 'Choose a delivery address.', phone: 'Bad.' },
    });
    expect(classifyPlaceError(api(409, 'branch_closed'))).toMatchObject({
      kind: 'step',
      step: 'branch',
    });
    expect(classifyPlaceError(api(409, 'ordering_paused'))).toMatchObject({
      kind: 'step',
      step: 'branch',
    });
    expect(classifyPlaceError(api(400, 'zone_not_served'))).toMatchObject({
      kind: 'step',
      step: 'address',
    });
    expect(classifyPlaceError(api(400, 'slot_invalid'))).toMatchObject({
      kind: 'step',
      step: 'time',
    });
    expect(classifyPlaceError(api(400, 'terms_not_accepted'))).toMatchObject({
      kind: 'step',
      step: 'details',
      fields: { terms: 'msg terms_not_accepted' },
    });
  });
  it('falls back to a generic message for anything else', () => {
    expect(classifyPlaceError(api(500, 'boom'))).toMatchObject({ kind: 'generic', code: 'boom' });
    expect(classifyPlaceError(new Error('x')).kind).toBe('generic');
  });
});

describe('createBackoff', () => {
  it('lengthens the wait while responses look the same, caps it, and resets on change', () => {
    const b = createBackoff({ base: 1000, max: 5000, factor: 2 });
    b.observe('a');
    expect(b.interval()).toBe(1000);
    b.observe('a');
    expect(b.interval()).toBe(2000);
    b.observe('a');
    expect(b.interval()).toBe(4000);
    b.observe('a');
    expect(b.interval()).toBe(5000);
    b.observe('b');
    expect(b.interval()).toBe(1000);
  });
});
