import { Badge } from '@/design';

/** Selected modifier options as readable chips ("Size: Large"). Group names disambiguate "Whole" milk vs "Whole" bean. */
export function OptionChips({ options }: { options: Array<{ group?: string; name: string }> }) {
  if (options.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Selected options">
      {options.map((o, i) => (
        <li key={`${o.group ?? ''}-${o.name}-${i}`}>
          <Badge tone="neutral" className="h-auto min-h-6 py-1 leading-tight whitespace-normal">
            {o.group ? <span className="text-text-muted">{o.group}:</span> : null}
            {o.name}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
