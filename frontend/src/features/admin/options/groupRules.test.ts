import { describe, expect, it } from 'vitest';
import {
  defaultsProblem,
  normaliseGroupRules,
  selectionHint,
  validateGroupRules,
} from './groupRules';
import { normaliseDelta, validateDelta } from './optionRules';

const rules = (r: Partial<Parameters<typeof validateGroupRules>[0]>) => ({
  selection_type: 'MULTIPLE' as const,
  is_required: false,
  min_select: 0,
  max_select: 3,
  ...r,
});

describe('validateGroupRules (mirrors the server)', () => {
  it('accepts valid combinations', () => {
    expect(validateGroupRules(rules({}))).toEqual({});
    expect(validateGroupRules(rules({ is_required: true, min_select: 1, max_select: 2 }))).toEqual(
      {},
    );
    expect(
      validateGroupRules({
        selection_type: 'SINGLE',
        is_required: true,
        min_select: 1,
        max_select: 1,
      }),
    ).toEqual({});
  });

  it('a choose-one group allows exactly one selection', () => {
    expect(
      validateGroupRules({
        selection_type: 'SINGLE',
        is_required: false,
        min_select: 0,
        max_select: 2,
      }).max_select,
    ).toBe('A choose-one group allows exactly one selection.');
  });

  it('minimum cannot exceed the maximum', () => {
    expect(
      validateGroupRules(rules({ is_required: true, min_select: 4, max_select: 3 })).min_select,
    ).toBe('Minimum cannot exceed the maximum.');
  });

  it('required groups need a minimum of at least 1; optional ones must have 0', () => {
    expect(validateGroupRules(rules({ is_required: true, min_select: 0 })).min_select).toBe(
      'A required group needs a minimum of at least 1.',
    );
    expect(validateGroupRules(rules({ is_required: false, min_select: 1 })).min_select).toBe(
      'Only required groups can have a minimum above 0.',
    );
  });

  it('maximum is at least 1 and numbers must be whole', () => {
    expect(validateGroupRules(rules({ max_select: 0 })).max_select).toBe('Must be at least 1.');
    expect(validateGroupRules(rules({ max_select: NaN })).max_select).toBe('Must be at least 1.');
    expect(validateGroupRules(rules({ min_select: -1 })).min_select).toBe('Cannot be negative.');
  });
});

describe('normaliseGroupRules', () => {
  it('forces max 1 and min from required for choose-one groups', () => {
    expect(
      normaliseGroupRules({
        selection_type: 'SINGLE',
        is_required: true,
        min_select: 0,
        max_select: 4,
      }),
    ).toMatchObject({ min_select: 1, max_select: 1 });
  });
  it('resets the minimum to 0 for optional multi-select groups', () => {
    expect(normaliseGroupRules(rules({ is_required: false, min_select: 2 })).min_select).toBe(0);
  });
});

describe('selectionHint', () => {
  it('describes what customers must do', () => {
    expect(
      selectionHint({ selection_type: 'SINGLE', is_required: true, min_select: 1, max_select: 1 }),
    ).toBe('Choose 1');
    expect(selectionHint(rules({ max_select: 3 }))).toBe('Choose up to 3');
    expect(selectionHint(rules({ is_required: true, min_select: 1, max_select: 2 }))).toBe(
      'Choose 1 to 2',
    );
    expect(selectionHint(rules({ is_required: true, min_select: 2, max_select: 2 }))).toBe(
      'Choose 2',
    );
  });
});

describe('defaultsProblem', () => {
  it('flags more active defaults than the maximum', () => {
    const opts = [
      { is_default: true, is_active: true },
      { is_default: true, is_active: true },
      { is_default: true, is_active: false },
    ];
    expect(defaultsProblem(opts, 2)).toBeNull();
    expect(defaultsProblem(opts, 1)).toBe('At most 1 option(s) can be the default.');
  });
});

describe('option price adjustment', () => {
  it('validates the range and format', () => {
    expect(validateDelta('0.60')).toBeNull();
    expect(validateDelta('-0.5')).toBeNull();
    expect(validateDelta('')).toMatch(/Enter/);
    expect(validateDelta('abc')).toMatch(/number/);
    expect(validateDelta('501')).toMatch(/between -50.00 and 500.00/);
    expect(validateDelta('-51')).toMatch(/between/);
  });
  it('normalises to two decimals as a string', () => {
    expect(normaliseDelta('0.6')).toBe('0.60');
    expect(normaliseDelta('+1')).toBe('1.00');
    expect(normaliseDelta('-0.5')).toBe('-0.50');
    expect(normaliseDelta('-0')).toBe('0.00');
    expect(normaliseDelta('x')).toBeNull();
  });
});
