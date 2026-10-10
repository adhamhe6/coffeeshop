import type { ReactNode } from 'react';
import { LogoGlyph } from '@/design';

interface AuthShellProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Big serif line on the editorial panel. */
  quote?: string;
}

/** Two-column auth layout: editorial espresso panel (≥ lg) + form. */
export function AuthShell({
  title,
  description,
  children,
  footer,
  quote = 'The lights are on. Come in and sit down.',
}: AuthShellProps) {
  return (
    <div className="grid min-h-[calc(100dvh-var(--header-h))] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside
        data-surface="dark"
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-surface-inverse text-text-inverse lg:block"
      >
        <LogoGlyph
          variant="mono"
          className="absolute -top-16 -right-28 h-[36rem] w-auto text-white/[0.06]"
        />
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <p className="eyebrow text-accent-on-dark">Lantern Coffee Roasters</p>
          <p className="max-w-md font-display text-[2.75rem] leading-[1.08] font-medium tracking-tight text-balance">
            {quote}
          </p>
        </div>
      </aside>
      <section className="flex items-start justify-center px-[var(--gutter)] py-12 sm:py-16 lg:items-center">
        <div className="w-full max-w-md">
          <h1 className="text-h2">{title}</h1>
          {description ? (
            <p className="mt-3 text-[1.0625rem] text-text-muted">{description}</p>
          ) : null}
          <div className="mt-8">{children}</div>
          {footer ? (
            <div className="mt-8 border-t border-border pt-6 text-[0.9375rem] text-text-muted">
              {footer}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export const authLinkClass =
  'rounded-xs font-medium text-accent-text underline underline-offset-4 hover:decoration-2';
