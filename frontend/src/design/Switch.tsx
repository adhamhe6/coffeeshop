import { useId, type ReactNode } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

export interface SwitchProps extends Omit<SwitchPrimitive.SwitchProps, 'children'> {
  label: ReactNode;
  description?: ReactNode;
}

export function Switch({ label, description, className, id, ...props }: SwitchProps) {
  const autoId = useId();
  const sid = id ?? autoId;
  const descId = description ? `${sid}-desc` : undefined;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="grid gap-0.5">
        <label htmlFor={sid} className="cursor-pointer text-[0.9375rem] leading-snug">
          {label}
        </label>
        {description ? (
          <p id={descId} className="text-sm text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <SwitchPrimitive.Root
        id={sid}
        aria-describedby={descId}
        className="relative h-6 w-11 shrink-0 rounded-pill border border-border-strong bg-surface-sunken transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent"
        {...props}
      >
        <SwitchPrimitive.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-text-muted shadow-xs transition-transform duration-[var(--duration-fast)] data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-white" />
      </SwitchPrimitive.Root>
    </div>
  );
}
