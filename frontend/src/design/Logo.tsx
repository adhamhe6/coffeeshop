import { useId, type SVGProps } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'color' | 'mono';

interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'title'> {
  /** `color`: copper bean, ink lantern. `mono`: everything uses currentColor. */
  variant?: Variant;
  /** Accessible name. Omit when the logo is decorative / next to visible text. */
  title?: string;
}

/**
 * The Lantern glyph: a lantern whose flame is a coffee bean.
 * Strokes use `currentColor`, so colour it with a text colour utility.
 */
export function LogoGlyph({ variant = 'color', title, className, ...rest }: GlyphProps) {
  const maskId = `crease-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const beanFill = variant === 'color' ? 'var(--color-accent)' : 'currentColor';
  return (
    <svg
      viewBox="0 0 40 48"
      fill="none"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="48">
          <rect width="40" height="48" fill="#fff" />
          <g transform="rotate(22 20 29)">
            <path
              d="M20 20.6c-3 2.8 3 5.8 0 8.4s3 5.6 0 8.4"
              stroke="#000"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
        </mask>
      </defs>
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 10.5C14.5 3 25.5 3 25.5 10.5" />
        <path d="M9.5 16 14 11h12l4.5 5Z" fill="currentColor" />
        <path d="M11 17.5C7.6 24.5 7.6 33 11.4 40h17.2c3.8-7 3.8-15.5.4-22.5" />
        <path d="M10 42.5h20" strokeWidth="2.2" />
      </g>
      <ellipse
        cx="20"
        cy="29"
        rx="5.3"
        ry="8.5"
        fill={beanFill}
        transform="rotate(22 20 29)"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'title'> {
  variant?: Variant;
  /** `horizontal` glyph + wordmark; `stacked` centred; `glyph` mark only. */
  lockup?: 'horizontal' | 'stacked' | 'glyph';
  /** Accessible name. Defaults to the brand name. Pass `''` to mark as decorative. */
  title?: string;
}

const BRAND = 'Lantern Coffee Roasters';

/** Logo lockups. Inherits colour from `currentColor`; wordmark uses the display serif. */
export function Logo({
  variant = 'color',
  lockup = 'horizontal',
  title = BRAND,
  className,
  ...rest
}: LogoProps) {
  if (lockup === 'glyph') {
    return (
      <LogoGlyph
        variant={variant}
        title={title || undefined}
        className={className}
        {...(rest as object)}
      />
    );
  }
  const stacked = lockup === 'stacked';
  const viewBox = stacked ? '0 0 168 104' : '0 0 196 48';
  return (
    <svg
      viewBox={viewBox}
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      <g transform={stacked ? 'translate(64 0)' : undefined}>
        <LogoGlyph variant={variant} width="40" height="48" x="0" y="0" />
      </g>
      <text
        x={stacked ? 84 : 50}
        y={stacked ? 78 : 27}
        textAnchor={stacked ? 'middle' : 'start'}
        fill="currentColor"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 27,
          letterSpacing: '-0.01em',
          fontVariationSettings: '"opsz" 72',
        }}
      >
        Lantern
      </text>
      <text
        x={stacked ? 84 : 51}
        y={stacked ? 95 : 41}
        textAnchor={stacked ? 'middle' : 'start'}
        fill="currentColor"
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: 7.4,
          letterSpacing: '0.22em',
        }}
      >
        COFFEE ROASTERS
      </text>
    </svg>
  );
}
