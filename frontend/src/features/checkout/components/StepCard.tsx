import type { ReactNode } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

interface StepCardProps {
  id: string;
  number: number;
  title: string;
  description?: ReactNode;
  /** Shown with a check once the step has a valid choice. */
  complete?: boolean;
  /** Server or validation problem for this step; announced and linked to the card. */
  error?: ReactNode;
  children: ReactNode;
}

/** One numbered section of the single-page checkout. All steps stay visible, so no fee or choice is hidden. */
export function StepCard({
  id,
  number,
  title,
  description,
  complete,
  error,
  children,
}: StepCardProps) {
  const headingId = `step-${id}-title`;
  return (
    <section
      id={`step-${id}`}
      aria-labelledby={headingId}
      data-step={id}
      className="scroll-mt-[calc(var(--header-h)+1rem)] rounded-lg border border-border bg-surface-raised p-5 sm:p-6"
    >
      <header className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
            complete
              ? 'border-success bg-success text-white'
              : 'border-border-strong bg-surface text-text',
          )}
        >
          {complete ? <Check className="size-4" strokeWidth={3} /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            tabIndex={-1}
            className="font-display text-h4 font-semibold outline-none"
          >
            {title}
            {complete ? <span className="sr-only"> (complete)</span> : null}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
        </div>
      </header>
      <div className="mt-4 grid gap-4 sm:pl-[3.125rem]">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-bg p-3 text-sm font-medium text-danger"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
        {children}
      </div>
    </section>
  );
}
