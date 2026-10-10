import { cn } from '@/lib/cn';

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}

/** Compact single-choice toggle (radio semantics): date presets, granularity, board/table view. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-md border border-border-strong bg-surface-raised p-0.5',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              'h-8 rounded-sm px-3 text-sm font-medium whitespace-nowrap transition-colors max-md:h-11 max-md:px-3.5',
              active
                ? 'bg-espresso text-cream'
                : 'text-text-muted hover:bg-surface-sunken hover:text-text',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
