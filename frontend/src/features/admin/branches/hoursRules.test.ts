import { describe, expect, it } from 'vitest';
import { copyDay, fromApi, toRequest, validateDay, validateWeek } from './hoursRules';

const api = [
  { weekday: 0, is_closed: false, opens: '06:30:00', closes: '20:00:00' },
  { weekday: 6, is_closed: true, opens: null, closes: null },
];

describe('hours rules', () => {
  it('builds seven rows, defaulting missing days to closed and trimming seconds', () => {
    const days = fromApi(api);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ weekday: 0, is_closed: false, opens: '06:30', closes: '20:00' });
    expect(days[3]?.is_closed).toBe(true);
    expect(days[6]?.is_closed).toBe(true);
  });

  it('requires closing after opening (no overnight hours) unless closed', () => {
    expect(validateDay({ weekday: 1, is_closed: false, opens: '09:00', closes: '09:00' })).toBe(
      'Closing time must be after opening time.',
    );
    expect(validateDay({ weekday: 1, is_closed: false, opens: '18:00', closes: '02:00' })).toBe(
      'Closing time must be after opening time.',
    );
    expect(validateDay({ weekday: 1, is_closed: false, opens: '', closes: '' })).toMatch(
      /Set both/,
    );
    expect(
      validateDay({ weekday: 1, is_closed: true, opens: '18:00', closes: '02:00' }),
    ).toBeNull();
    expect(
      validateDay({ weekday: 1, is_closed: false, opens: '07:00', closes: '18:00' }),
    ).toBeNull();
  });

  it('reports errors per weekday', () => {
    const days = fromApi(api).map((d) => (d.weekday === 0 ? { ...d, closes: '05:00' } : d));
    expect(Object.keys(validateWeek(days))).toEqual(['0']);
  });

  it('copies one day to all others, including its closed state', () => {
    const days = fromApi(api);
    const copied = copyDay(days, 0);
    expect(copied.every((d) => !d.is_closed && d.opens === '06:30' && d.closes === '20:00')).toBe(
      true,
    );
    const closed = copyDay(days, 6);
    expect(closed.every((d) => d.is_closed)).toBe(true);
    const some = copyDay(days, 0, [1, 2]);
    expect(some[1]?.opens).toBe('06:30');
    expect(some[3]?.is_closed).toBe(true);
  });

  it('builds the request with null times for closed days', () => {
    const req = toRequest(fromApi(api));
    expect(req[0]).toEqual({ weekday: 0, is_closed: false, opens: '06:30', closes: '20:00' });
    expect(req[6]).toEqual({ weekday: 6, is_closed: true, opens: null, closes: null });
  });
});
