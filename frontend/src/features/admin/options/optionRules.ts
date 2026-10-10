/** Option price adjustment, mirroring the server: decimal string, -50.00 … 500.00, at most 2 decimals. */
export const DELTA_PATTERN = /^[+-]?\d{1,3}(\.\d{1,2})?$/;

export function validateDelta(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return 'Enter a price adjustment (0 for none).';
  if (!DELTA_PATTERN.test(v)) return 'Use a number like 0.60 or -0.50 (up to 2 decimals).';
  const n = Number(v);
  if (n < -50 || n > 500) return 'Price adjustment must be between -50.00 and 500.00.';
  return null;
}

/** "0.6" → "0.60", "+1" → "1.00", "-.5" invalid → null. */
export function normaliseDelta(raw: string): string | null {
  const v = raw.trim().replace(/^\+/, '');
  if (!DELTA_PATTERN.test(raw.trim())) return null;
  const sign = v.startsWith('-') ? '-' : '';
  const [whole = '0', frac = ''] = v.replace('-', '').split('.');
  const out = `${whole.replace(/^0+(?=\d)/, '')}.${frac.padEnd(2, '0')}`;
  return out === '0.00' ? out : `${sign}${out}`;
}
