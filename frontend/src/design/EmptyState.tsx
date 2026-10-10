import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { LogoGlyph } from './Logo';

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Heading level to use for the title. */
  as?: 'h1' | 'h2' | 'h3' | 'h4';
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  as: Heading = 'h2',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center',
        className,
      )}
    >
      <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-surface-sunken text-text-muted [&_svg]:size-6">
        {icon ?? <LogoGlyph variant="mono" className="h-7 w-auto" />}
      </div>
      <Heading className="font-display text-h4 font-semibold text-text">{title}</Heading>
      {description ? <p className="text-[0.9375rem] text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
