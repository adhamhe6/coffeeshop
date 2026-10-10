import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Loading placeholder. Decorative: pair with a labelled busy region (`aria-busy`) at the page level. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-surface-sunken)_25%,color-mix(in_srgb,var(--color-surface-sunken)_55%,var(--color-surface-raised))_50%,var(--color-surface-sunken)_75%)] bg-[length:200%_100%] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('grid gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3.5', i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}
