import type { ReactNode } from 'react';
import { Breadcrumbs, type Crumb } from '@/design';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}

/** Page title block for the dense admin theme: one `h1`, optional crumbs, supporting copy and primary actions. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn('mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}
    >
      <div className="min-w-0">
        {breadcrumbs ? <Breadcrumbs items={breadcrumbs} className="mb-2" /> : null}
        <h1 className="font-display text-[1.625rem] leading-tight font-semibold text-text">
          {title}
        </h1>
        {description ? (
          <div className="mt-1 max-w-2xl text-sm text-text-muted">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
