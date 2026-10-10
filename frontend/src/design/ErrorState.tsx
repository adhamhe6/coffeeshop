import type { ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { describeError } from '@/lib/api/errors';
import { Button } from './Button';

interface ErrorStateProps {
  /** Any thrown value (ApiError is rendered nicely); overridden by explicit title/message. */
  error?: unknown;
  title?: ReactNode;
  message?: ReactNode;
  requestId?: string;
  onRetry?: () => void;
  retrying?: boolean;
  action?: ReactNode;
  className?: string;
}

/** Inline error block with a retry affordance. Announced politely to screen readers. */
export function ErrorState({
  error,
  title,
  message,
  requestId,
  onRetry,
  retrying,
  action,
  className,
}: ErrorStateProps) {
  const described = error !== undefined ? describeError(error) : undefined;
  const rid = requestId ?? described?.requestId;
  return (
    <div
      role="alert"
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center',
        className,
      )}
    >
      <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-danger-bg text-danger">
        <TriangleAlert aria-hidden="true" className="size-6" />
      </div>
      <h2 className="font-display text-h4 font-semibold">
        {title ?? described?.title ?? 'Something went wrong'}
      </h2>
      <p className="text-[0.9375rem] text-text-muted">
        {message ?? described?.message ?? 'Please try again in a moment.'}
      </p>
      {rid ? <p className="text-xs text-text-muted">Reference: {rid}</p> : null}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {onRetry ? (
          <Button
            variant="secondary"
            onClick={onRetry}
            loading={retrying}
            leadingIcon={<RotateCw aria-hidden="true" className="size-4" />}
          >
            Try again
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
