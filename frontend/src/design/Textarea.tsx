import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { controlBase, controlBorder, useFieldControl } from './Field';

export interface TextareaProps extends ComponentProps<'textarea'> {
  invalid?: boolean;
}

export function Textarea({
  className,
  invalid,
  id,
  disabled,
  required,
  rows = 4,
  'aria-describedby': describedBy,
  ...props
}: TextareaProps) {
  const field = useFieldControl();
  return (
    <textarea
      id={id ?? field?.id}
      rows={rows}
      disabled={disabled ?? field?.disabled}
      required={required ?? field?.required}
      aria-invalid={(invalid ?? field?.invalid) ? true : undefined}
      aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
      className={cn(
        controlBase,
        controlBorder,
        'min-h-24 resize-y px-3.5 py-2.5 text-base leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}
