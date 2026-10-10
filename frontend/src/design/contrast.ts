/** WCAG 2.x contrast helpers. Used by the token tests and by `npm run contrast`. */

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) throw new Error(`Not a hex colour: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Extract `--color-*: #hex` declarations from CSS text, optionally scoped to one block selector. */
export function readColorTokens(css: string, scope?: string): Record<string, string> {
  let source = css;
  if (scope) {
    const start = css.indexOf(scope);
    if (start === -1) throw new Error(`Scope not found: ${scope}`);
    const open = css.indexOf('{', start);
    const close = css.indexOf('\n}', open);
    source = css.slice(open, close);
  }
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    out[m[1] as string] = m[2] as string;
  }
  return out;
}

export interface ContrastPair {
  fg: string;
  bg: string;
  /** 4.5 for body text, 3 for large text and UI component boundaries. */
  min: 4.5 | 3;
  note: string;
}

/** Every foreground/background combination the components rely on. */
export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: 'text', bg: 'surface', min: 4.5, note: 'body text on page' },
  { fg: 'text', bg: 'surface-raised', min: 4.5, note: 'body text on cards' },
  { fg: 'text', bg: 'surface-sunken', min: 4.5, note: 'body text on wells' },
  { fg: 'text-muted', bg: 'surface', min: 4.5, note: 'secondary text on page' },
  { fg: 'text-muted', bg: 'surface-raised', min: 4.5, note: 'secondary text on cards' },
  { fg: 'text-muted', bg: 'surface-sunken', min: 4.5, note: 'secondary text on wells' },
  { fg: 'text-inverse', bg: 'surface-inverse', min: 4.5, note: 'text on espresso' },
  { fg: 'text-inverse-muted', bg: 'surface-inverse', min: 4.5, note: 'secondary text on espresso' },
  { fg: 'accent-on-dark', bg: 'surface-inverse', min: 4.5, note: 'copper text on espresso' },
  { fg: 'danger-on-dark', bg: 'surface-inverse', min: 4.5, note: 'error text on espresso' },
  { fg: 'accent-foreground', bg: 'accent', min: 4.5, note: 'primary button label' },
  { fg: 'accent-foreground', bg: 'accent-hover', min: 4.5, note: 'primary button label (hover)' },
  { fg: 'accent-text', bg: 'surface', min: 4.5, note: 'copper text on page' },
  { fg: 'accent-text', bg: 'surface-raised', min: 4.5, note: 'copper text on cards' },
  { fg: 'accent-text', bg: 'surface-sunken', min: 4.5, note: 'copper text on wells' },
  { fg: 'accent-text', bg: 'accent-soft', min: 4.5, note: 'copper text on tinted badge' },
  { fg: 'success', bg: 'success-bg', min: 4.5, note: 'success badge' },
  { fg: 'warning', bg: 'warning-bg', min: 4.5, note: 'warning badge' },
  { fg: 'danger', bg: 'danger-bg', min: 4.5, note: 'danger badge' },
  { fg: 'info', bg: 'info-bg', min: 4.5, note: 'info badge' },
  { fg: 'neutral', bg: 'neutral-bg', min: 4.5, note: 'neutral badge' },
  { fg: 'success', bg: 'surface', min: 4.5, note: 'success text on page' },
  { fg: 'danger', bg: 'surface', min: 4.5, note: 'error text on page' },
  { fg: 'danger', bg: 'surface-raised', min: 4.5, note: 'error text under inputs' },
  { fg: 'accent-foreground', bg: 'danger', min: 4.5, note: 'danger button label' },
  { fg: 'accent-foreground', bg: 'sage', min: 4.5, note: 'sage fills with white text' },
  { fg: 'border-strong', bg: 'surface', min: 3, note: 'control outline on page' },
  { fg: 'border-strong', bg: 'surface-raised', min: 3, note: 'control outline on cards' },
  { fg: 'focus', bg: 'surface', min: 3, note: 'focus ring on page' },
  { fg: 'focus', bg: 'accent', min: 3, note: 'focus ring next to primary button' },
  { fg: 'accent', bg: 'surface', min: 3, note: 'copper icons / large display text' },
];

/** Same pairs, admin theme overrides applied. */
export const ADMIN_CONTRAST_PAIRS: ContrastPair[] = CONTRAST_PAIRS.filter(
  (p) =>
    ![
      'surface-inverse',
      'text-inverse',
      'text-inverse-muted',
      'accent-on-dark',
      'danger-on-dark',
    ].some((t) => p.bg === t || p.fg === t),
);
