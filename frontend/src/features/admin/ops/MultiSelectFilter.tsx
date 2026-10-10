import { ChevronDown } from 'lucide-react';
import { Checkbox, Popover, PopoverContent, PopoverTrigger } from '@/design';
import { cn } from '@/lib/cn';

export interface FilterOption {
  value: string;
  label: string;
}

/** Popover with a checkbox per option; the trigger summarises the selection ("Status: 2 selected"). */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  className,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const summary =
    selected.length === 0
      ? 'Any'
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} filter: ${summary}`}
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 text-sm hover:bg-surface-sunken max-md:h-11',
            selected.length > 0 && 'border-accent',
            className,
          )}
        >
          <span className="text-text-muted">{label}:</span>
          <span className="max-w-32 truncate font-medium">{summary}</span>
          <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <fieldset className="grid gap-0.5">
          <legend className="sr-only">{label}</legend>
          {options.map((o) => (
            <div key={o.value} className="rounded-sm px-2 py-1.5 hover:bg-surface-sunken">
              <Checkbox
                label={o.label}
                checked={selected.includes(o.value)}
                onCheckedChange={(c) =>
                  onChange(
                    c === true ? [...selected, o.value] : selected.filter((v) => v !== o.value),
                  )
                }
              />
            </div>
          ))}
        </fieldset>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium text-accent-text hover:bg-accent-soft"
          >
            Clear {label.toLowerCase()}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
