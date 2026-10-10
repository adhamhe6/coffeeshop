import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_CONTRAST_PAIRS, CONTRAST_PAIRS, contrastRatio, readColorTokens } from './contrast';

const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
const base = readColorTokens(css, '@theme');
const admin = { ...base, ...readColorTokens(css, "[data-theme='admin']") };

describe('brand palette', () => {
  it('matches the plan §8 hex values exactly', () => {
    expect(base).toMatchObject({
      espresso: '#2b1d16',
      cream: '#f7f0e3',
      parchment: '#efe4d0',
      sage: '#5e6e55',
      copper: '#b4602b',
      ink: '#1b1410',
    });
  });

  it('defines every semantic token the design system relies on', () => {
    for (const name of [
      'surface',
      'surface-raised',
      'border',
      'text',
      'text-muted',
      'accent',
      'success',
      'warning',
      'danger',
      'info',
    ]) {
      expect(base[name], name).toBeTruthy();
    }
  });
});

describe('WCAG contrast', () => {
  it.each(CONTRAST_PAIRS)('storefront: $fg on $bg ($note) >= $min', ({ fg, bg, min }) => {
    expect(base[fg], `token ${fg}`).toBeTruthy();
    expect(base[bg], `token ${bg}`).toBeTruthy();
    expect(contrastRatio(base[fg] as string, base[bg] as string)).toBeGreaterThanOrEqual(min);
  });

  it.each(ADMIN_CONTRAST_PAIRS)('admin theme: $fg on $bg ($note) >= $min', ({ fg, bg, min }) => {
    expect(contrastRatio(admin[fg] as string, admin[bg] as string)).toBeGreaterThanOrEqual(min);
  });

  it('computes known reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
