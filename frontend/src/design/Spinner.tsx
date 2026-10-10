import { cn } from '@/lib/cn';

interface SpinnerProps {
  className?: string;
  /** Screen-reader text. Pass `null` when a parent already announces the busy state. */
  label?: string | null;
}

export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={cn('size-4 animate-spin-slow motion-reduce:animate-none', className)}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
