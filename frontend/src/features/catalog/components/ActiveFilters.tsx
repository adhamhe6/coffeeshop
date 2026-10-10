import { X } from 'lucide-react';
import { Button } from '@/design';
import type { FilterChip } from '../filters';

interface ActiveFiltersProps {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
}

/** Removable chips for each active filter plus "Clear all". Renders nothing when no filter is active. */
export function ActiveFilters({ chips, onRemove, onClearAll }: ActiveFiltersProps) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            onClick={() => onRemove(chip)}
            aria-label={`Remove filter: ${chip.label}`}
            className="inline-flex h-11 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised pr-2.5 pl-3.5 text-sm font-medium transition-colors hover:border-text sm:h-9"
          >
            {chip.label}
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </li>
      ))}
      <li>
        <Button variant="link" onClick={onClearAll} className="px-1 text-sm">
          Clear all
        </Button>
      </li>
    </ul>
  );
}
