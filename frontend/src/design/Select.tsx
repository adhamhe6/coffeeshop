import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { controlBase, controlBorder, useFieldControl } from './Field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  size?: 'md' | 'sm';
  className?: string;
  'aria-label'?: string;
}

/** Radix Select with house styling. Option values must be non-empty strings. */
export function Select({
  options,
  placeholder = 'Select…',
  id,
  invalid,
  size = 'md',
  className,
  disabled,
  required,
  'aria-label': ariaLabel,
  ...root
}: SelectProps) {
  const field = useFieldControl();
  return (
    <SelectPrimitive.Root
      disabled={disabled ?? field?.disabled}
      required={required ?? field?.required}
      {...root}
    >
      <SelectPrimitive.Trigger
        id={id ?? field?.id}
        aria-label={ariaLabel}
        aria-invalid={(invalid ?? field?.invalid) ? true : undefined}
        aria-describedby={field?.describedBy}
        className={cn(
          controlBase,
          controlBorder,
          'inline-flex items-center justify-between gap-2 text-left data-[placeholder]:text-text-muted',
          size === 'md' ? 'h-11 px-3.5 text-base' : 'h-9 px-3 text-sm',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-[70] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface-raised text-text shadow-md data-[state=open]:animate-pop-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex min-h-10 cursor-pointer items-center rounded-sm py-2 pr-8 pl-3 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-sunken"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5">
                  <Check aria-hidden="true" className="size-4 text-accent-text" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
