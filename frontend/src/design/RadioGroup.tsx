import { useId, type ReactNode } from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

export function RadioGroup({ className, ...props }: RadioGroupPrimitive.RadioGroupProps) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-3', className)} {...props} />;
}

const indicator =
  'flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-raised transition-colors group-data-[state=checked]:border-accent data-[state=checked]:border-accent';
const dot = 'block size-2.5 rounded-full bg-accent';

export interface RadioProps extends Omit<RadioGroupPrimitive.RadioGroupItemProps, 'children'> {
  label: ReactNode;
  description?: ReactNode;
}

/** Plain radio with a label to its right. */
export function Radio({ label, description, className, id, ...props }: RadioProps) {
  const autoId = useId();
  const rid = id ?? autoId;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <RadioGroupPrimitive.Item
        id={rid}
        className={cn(indicator, 'mt-0.5 hover:border-text disabled:opacity-50')}
        {...props}
      >
        <RadioGroupPrimitive.Indicator>
          <span className={dot} />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
      <div className="grid gap-0.5">
        <label htmlFor={rid} className="cursor-pointer text-[0.9375rem] leading-snug">
          {label}
        </label>
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
      </div>
    </div>
  );
}

export interface RadioCardProps extends Omit<
  RadioGroupPrimitive.RadioGroupItemProps,
  'children' | 'title'
> {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned detail such as a price or ETA. */
  meta?: ReactNode;
  icon?: ReactNode;
}

/**
 * Selectable card: the whole card is the radio (a single tab stop per group, arrows move selection).
 * Selected state shows a filled indicator + thicker border, not colour alone.
 */
export function RadioCard({ title, description, meta, icon, className, ...props }: RadioCardProps) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'group flex w-full items-start gap-3.5 rounded-lg border border-border-strong bg-surface-raised p-4 text-left transition-[border-color,background-color,box-shadow]',
        'hover:border-text data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-accent)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    >
      <span className={cn(indicator, 'mt-0.5')} aria-hidden="true">
        <RadioGroupPrimitive.Indicator forceMount className="data-[state=unchecked]:hidden">
          <span className={dot} />
        </RadioGroupPrimitive.Indicator>
      </span>
      {icon ? <span className="mt-0.5 text-accent-text [&_svg]:size-5">{icon}</span> : null}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium text-text">{title}</span>
        {description ? <span className="text-sm text-text-muted">{description}</span> : null}
      </span>
      {meta ? <span className="text-sm font-medium text-text">{meta}</span> : null}
    </RadioGroupPrimitive.Item>
  );
}
