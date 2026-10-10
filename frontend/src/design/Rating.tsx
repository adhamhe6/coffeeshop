import { useState } from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

interface RatingProps {
  /** 0–5, fractions allowed. */
  value: number;
  /** Number of reviews (shown in parentheses and in the accessible label). */
  count?: number;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
  /** One star + number + count instead of five stars (cards, tight spaces). */
  compact?: boolean;
  className?: string;
}

const sizes = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' } as const;

/** Read-only stars, exposed to AT as a single image with a text alternative. */
export function Rating({
  value,
  count,
  size = 'md',
  showValue = false,
  compact = false,
  className,
}: RatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const label = `Rated ${clamped.toFixed(1)} out of 5${count !== undefined ? ` from ${count} ${count === 1 ? 'review' : 'reviews'}` : ''}`;
  if (compact) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('inline-flex items-center gap-1 text-sm', className)}
      >
        <Star
          aria-hidden="true"
          className={cn(sizes[size], 'fill-accent text-accent')}
          strokeWidth={1.5}
        />
        <span aria-hidden="true" className="font-medium text-text tabular-nums">
          {clamped.toFixed(1)}
        </span>
        {count !== undefined ? (
          <span aria-hidden="true" className="tabular-nums">
            ({count})
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span role="img" aria-label={label} className="relative inline-flex gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, clamped - i));
          return (
            <span key={i} className="relative inline-block">
              <Star
                aria-hidden="true"
                className={cn(sizes[size], 'text-border-strong')}
                strokeWidth={1.5}
              />
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star
                  aria-hidden="true"
                  className={cn(sizes[size], 'fill-accent text-accent')}
                  strokeWidth={1.5}
                />
              </span>
            </span>
          );
        })}
      </span>
      {showValue ? <span className="font-medium tabular-nums">{clamped.toFixed(1)}</span> : null}
      {count !== undefined ? <span className="text-text-muted tabular-nums">({count})</span> : null}
    </span>
  );
}

interface RatingInputProps {
  value: number | null;
  onChange: (value: number) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** Star picker built on a radio group: one tab stop, arrow keys change the rating. */
export function RatingInput({
  value,
  onChange,
  label = 'Rating',
  disabled,
  className,
}: RatingInputProps) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value ? String(value) : ''}
      onValueChange={(v) => onChange(Number(v))}
      disabled={disabled}
      orientation="horizontal"
      className={cn('inline-flex gap-1', className)}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <RadioGroupPrimitive.Item
          key={n}
          value={String(n)}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          onMouseEnter={() => setHover(n)}
          className="rounded-sm p-1 disabled:opacity-50"
        >
          <Star
            aria-hidden="true"
            className={cn(
              'size-7 transition-colors',
              n <= shown ? 'fill-accent text-accent' : 'text-border-strong',
            )}
            strokeWidth={1.5}
          />
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
