import { describe, expect, it } from 'vitest';
import {
  BLANK_COUPON,
  couponStatus,
  describeCoupon,
  formToPayload,
  generateCouponCode,
  type CouponFormValues,
} from './couponLogic';
import { isoToZonedInput, zonedInputToIso } from '../people-kit/datetime';

const money = (v: string | number) => `$${Number(v)}`;
const form = (over: Partial<CouponFormValues>): CouponFormValues => ({ ...BLANK_COUPON, ...over });
const ctx = {
  money,
  timeZone: 'America/New_York',
  categoryNames: ['Seasonal drinks'],
  productNames: [],
  now: new Date('2026-10-10T12:00:00Z'),
};

describe('describeCoupon (plain-language summary)', () => {
  it('reads like the owner would say it', () => {
    const text = describeCoupon(
      form({
        code: 'autumn15',
        discount_type: 'PERCENT',
        value: '15',
        max_discount: '6',
        min_order_total: '10',
        applies_to: 'CATEGORIES',
        category_ids: [3],
        ends_at: '2026-11-30T23:59',
      }),
      ctx,
    );
    expect(text).toBe(
      'Customers enter AUTUMN15: 15% off Seasonal drinks, max $6, orders of $10 or more, until Nov 30.',
    );
  });

  it('describes automatic fixed-amount promotions and first-order rules', () => {
    const text = describeCoupon(
      form({ is_automatic: true, discount_type: 'FIXED', value: '3', first_order_only: true }),
      ctx,
    );
    expect(text).toBe(
      "Applied automatically at checkout: $3 off the whole order, customer's first order only.",
    );
  });

  it('asks for a discount before summarising', () => {
    expect(describeCoupon(form({}), ctx)).toMatch(/Fill in the discount/);
  });

  it('ignores the max cap for fixed discounts', () => {
    expect(
      describeCoupon(
        form({ code: 'X1', discount_type: 'FIXED', value: '2', max_discount: '9' }),
        ctx,
      ),
    ).not.toMatch(/max/);
  });
});

describe('formToPayload', () => {
  it('builds the API payload with decimal strings, store-timezone dates and nulls for blanks', () => {
    const payload = formToPayload(
      form({
        code: ' summer10 ',
        name: ' Summer ',
        value: '10',
        min_order_total: '',
        max_discount: '5',
        starts_at: '2026-06-01T09:00',
        usage_limit: '100',
        applies_to: 'PRODUCTS',
        product_ids: [4, 9],
        category_ids: [1],
      }),
      'America/New_York',
    );
    expect(payload).toMatchObject({
      code: 'SUMMER10',
      name: 'Summer',
      discount_type: 'PERCENT',
      value: '10.00',
      max_discount: '5.00',
      min_order_total: '0.00',
      applies_to: 'PRODUCTS',
      product_ids: [4, 9],
      category_ids: [],
      starts_at: '2026-06-01T13:00:00.000Z',
      ends_at: null,
      usage_limit: 100,
      per_customer_limit: null,
    });
  });

  it('drops the cap for fixed-amount coupons', () => {
    expect(
      formToPayload(
        form({ code: 'ABC', discount_type: 'FIXED', value: '2', max_discount: '9' }),
        'UTC',
      ).max_discount,
    ).toBeNull();
  });
});

describe('couponStatus', () => {
  const base = {
    is_active: true,
    starts_at: null,
    ends_at: null,
    usage_limit: null,
    times_redeemed: 0,
  };
  const now = Date.parse('2026-10-10T12:00:00Z');
  it('derives the chips shown in the list', () => {
    expect(couponStatus(base, now)).toBe('active');
    expect(couponStatus({ ...base, is_active: false }, now)).toBe('inactive');
    expect(couponStatus({ ...base, starts_at: '2026-11-01T00:00:00Z' }, now)).toBe('scheduled');
    expect(couponStatus({ ...base, ends_at: '2026-10-01T00:00:00Z' }, now)).toBe('expired');
    expect(couponStatus({ ...base, usage_limit: 5, times_redeemed: 5 }, now)).toBe('exhausted');
  });
});

describe('store timezone helpers', () => {
  it('round-trips wall-clock times through UTC, across DST', () => {
    for (const local of ['2026-01-15T08:30', '2026-07-15T08:30', '2026-03-08T12:00']) {
      const iso = zonedInputToIso(local, 'America/New_York');
      expect(isoToZonedInput(iso, 'America/New_York')).toBe(local);
    }
    expect(zonedInputToIso('2026-01-15T08:30', 'America/New_York')).toBe(
      '2026-01-15T13:30:00.000Z',
    );
    expect(zonedInputToIso('', 'UTC')).toBeNull();
  });
});

describe('generateCouponCode', () => {
  it('makes codes that pass the server pattern', () => {
    for (let i = 0; i < 20; i++) expect(generateCouponCode()).toMatch(/^[A-Z0-9][A-Z0-9_-]{2,39}$/);
  });
});
