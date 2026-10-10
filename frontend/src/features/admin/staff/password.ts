const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '-_.!#$%';

function pick(set: string, rand: Uint32Array, i: number) {
  return set.charAt((rand[i] ?? 0) % set.length);
}

/**
 * Random temporary password (browser CSPRNG). 16 characters, no look-alike glyphs, always contains upper, lower,
 * digit and symbol so it passes the server's rules. Shown once to the admin, who shares it securely.
 */
export function generateTemporaryPassword(length = 16): string {
  const rand = new Uint32Array(length * 2);
  crypto.getRandomValues(rand);
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [
    pick(UPPER, rand, 0),
    pick(LOWER, rand, 1),
    pick(DIGITS, rand, 2),
    pick(SYMBOLS, rand, 3),
  ];
  for (let i = 4; i < length; i++) chars.push(pick(all, rand, i));
  // Fisher-Yates with the second half of the random pool.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = (rand[length + (i % length)] ?? 0) % (i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
