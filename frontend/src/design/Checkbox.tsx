import { useId, type ReactNode } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<CheckboxPrimitive.CheckboxProps, 'children'> {
  label: ReactNode;
  description?: ReactNode;
  invalid?: boolean;
}

export function Checkbox({ label, description, invalid, className, id, ...props }: CheckboxProps) {
  const autoId = useId();
  const cid = id ?? autoId;
  const descId = description ? `${cid}-desc` : undefined;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <CheckboxPrimitive.Root
        id={cid}
        aria-describedby={descId}
        aria-invalid={invalid || undefined}
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-xs border border-border-strong bg-surface-raised text-accent-foreground transition-colors hover:border-text disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent"
        {...props}
      >
        <CheckboxPrimitive.Indicator>
          {props.checked === 'indeterminate' ? (
            <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} />
          ) : (
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div className="grid gap-0.5">
        <label htmlFor={cid} className="cursor-pointer text-[0.9375rem] leading-snug text-text">
          {label}
        </label>
        {description ? (
          <p id={descId} className="text-sm text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
