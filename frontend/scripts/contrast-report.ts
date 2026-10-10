/* Prints the contrast table for every token pair: `npm run contrast` (Node >= 22 strips types natively). */
import { readFileSync } from 'node:fs';
import {
  ADMIN_CONTRAST_PAIRS,
  CONTRAST_PAIRS,
  contrastRatio,
  readColorTokens,
} from '../src/design/contrast.ts';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const base = readColorTokens(css, '@theme');
const admin = { ...base, ...readColorTokens(css, "[data-theme='admin']") };

let failures = 0;
function report(title: string, tokens: Record<string, string>, pairs: typeof CONTRAST_PAIRS) {
  console.log(`\n${title}`);
  for (const p of pairs) {
    const fg = tokens[p.fg];
    const bg = tokens[p.bg];
    if (!fg || !bg) throw new Error(`Unknown token in pair ${p.fg}/${p.bg}`);
    const ratio = contrastRatio(fg, bg);
    const ok = ratio >= p.min;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2).padStart(5)} (min ${p.min})  ${p.fg} on ${p.bg}  — ${p.note}`,
    );
  }
}
report('Storefront theme', base, CONTRAST_PAIRS);
report('Admin theme', admin, ADMIN_CONTRAST_PAIRS);
if (failures) {
  console.error(`\n${failures} pair(s) below threshold`);
  process.exit(1);
}
