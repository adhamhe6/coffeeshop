import { useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Name of the thing being counted, used in button labels ("Increase quantity of Flat white"). */
  itemLabel?: string;
  className?: string;
}

/** Accessible number stepper: - / text input / +. Typing is committed on blur or Enter and clamped to min/max. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 50,
  disabled,
  size = 'md',
  itemLabel,
  className,
}: QuantityStepperProps) {
  const id = useId();
  // `null` = not typing: show the controlled value. Typing keeps a local draft until blur/Enter.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = () => {
    const parsed = Number.parseInt(shown, 10);
    const next = Number.isNaN(parsed) ? value : clamp(parsed);
    setDraft(null);
    if (next !== value) onChange(next);
  };
  const of = itemLabel ? ` of ${itemLabel}` : '';
  const btn = cn(
    'flex items-center justify-center text-text transition-colors hover:bg-surface-sunken disabled:pointer-events-none disabled:opacity-40',
    size === 'md' ? 'size-11' : 'size-9',
  );

  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      className={cn(
        'inline-flex items-center overflow-hidden rounded-md border border-border-strong bg-surface-raised',
        className,
      )}
    >
      <span id={`${id}-label`} className="sr-only">
        Quantity{of}
      </span>
      <button
        type="button"
        className={btn}
        aria-label={`Decrease quantity${of}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`Quantity${of}`}
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(clamp(value + 1));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value - 1));
          }
        }}
        className={cn(
          'bg-transparent text-center text-[0.9375rem] font-medium tabular-nums outline-none focus-visible:bg-surface-sunken',
          size === 'md' ? 'h-11 w-11' : 'h-9 w-10',
        )}
      />
      <button
        type="button"
        className={btn}
        aria-label={`Increase quantity${of}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
