import { useId } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

interface MiniSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Active: Espresso". */
  label: string;
  disabled?: boolean;
  className?: string;
  /** Visible text label next to the switch (clicking it toggles). Omit in table cells whose header names the column. */
  text?: string;
}

/** Compact on/off switch for table rows (the visible label lives in the column header). */
export function MiniSwitch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  text,
}: MiniSwitchProps) {
  const id = useId();
  const control = (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-pill border border-border-strong bg-surface-sunken transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        // 44px touch target without enlarging the visual control.
        'before:absolute before:-inset-3 before:content-[""] md:before:-inset-1.5',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 translate-x-[2px] rounded-full bg-text-muted shadow-xs transition-transform duration-[var(--duration-fast)] data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-white" />
    </SwitchPrimitive.Root>
  );
  if (!text) return control;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {control}
      <label htmlFor={id} className="cursor-pointer">
        {text}
      </label>
    </span>
  );
}
