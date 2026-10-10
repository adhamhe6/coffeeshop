import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Page title row for admin pages: one `h1`, optional description and right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[1.625rem] leading-tight font-semibold">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-prose text-sm text-text-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-1.5">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>
      ) : null}
    </header>
  );
}

/** A bordered white panel with a heading, the basic container for dashboard sections. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  headingLevel: H = 'h2',
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 'h2' | 'h3';
  bodyClassName?: string;
}) {
  return (
    <section className={cn('min-w-0 rounded-lg border border-border bg-surface-raised', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            {title ? (
              <H className="font-sans text-[0.9375rem] leading-snug font-semibold">{title}</H>
            ) : null}
            {description ? <p className="text-sm text-text-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
