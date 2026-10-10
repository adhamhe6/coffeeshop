import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { controlBase, controlBorder, useFieldControl } from './Field';

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  invalid?: boolean;
  /** Decorative element at the start of the input (icon). */
  leading?: ReactNode;
  /** Element at the end (button, unit). Must be interactive-safe. */
  trailing?: ReactNode;
  size?: 'md' | 'sm';
}

export function Input({
  className,
  invalid,
  leading,
  trailing,
  size = 'md',
  id,
  disabled,
  required,
  'aria-describedby': describedBy,
  ...props
}: InputProps) {
  const field = useFieldControl();
  const input = (
    <input
      id={id ?? field?.id}
      disabled={disabled ?? field?.disabled}
      required={required ?? field?.required}
      aria-invalid={(invalid ?? field?.invalid) ? true : undefined}
      aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
      className={cn(
        controlBase,
        controlBorder,
        size === 'md' ? 'h-11 px-3.5 text-base' : 'h-9 px-3 text-sm',
        leading && 'pl-10',
        trailing && 'pr-11',
        className,
      )}
      {...props}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className="relative">
      {leading ? (
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-text-muted [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      {input}
      {trailing ? (
        <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>
      ) : null}
    </div>
  );
}
