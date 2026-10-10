import { Check } from 'lucide-react';
import { Badge, Money } from '@/design';
import type { AdminModifierGroup } from '@/lib/api/adminCatalog';
import { selectionHint } from '../../options/groupRules';

/** The group as customers see it on the product page (inactive options are hidden, unavailable ones disabled). */
export function GroupPreview({ group }: { group: AdminModifierGroup }) {
  const visible = group.options.filter((o) => o.is_active);
  const multiple = group.selection_type === 'MULTIPLE';
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{group.display_name}</h4>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span>{selectionHint(group)}</span>
          {group.is_required ? (
            <Badge size="sm">Required</Badge>
          ) : (
            <Badge size="sm" tone="outline">
              Optional
            </Badge>
          )}
        </div>
      </div>
      {!group.is_active ? (
        <p className="mt-2 text-sm font-medium text-warning">
          This group is inactive, so customers will not see it.
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">This group has no active options.</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {visible.map((o) => (
            <li
              key={o.id}
              className="flex items-center gap-2.5 text-sm"
              aria-disabled={!o.is_available || undefined}
            >
              <span
                aria-hidden="true"
                className={`flex size-4 shrink-0 items-center justify-center border border-border-strong ${multiple ? 'rounded-xs' : 'rounded-full'} ${o.is_default ? 'bg-accent text-accent-foreground' : 'bg-surface-raised'}`}
              >
                {o.is_default ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className={o.is_available ? '' : 'text-text-muted line-through'}>{o.name}</span>
              {!o.is_available ? (
                <Badge size="sm" tone="neutral">
                  Unavailable
                </Badge>
              ) : null}
              {Number(o.price_delta) !== 0 ? (
                <Money value={o.price_delta} signed className="ml-auto text-text-muted" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
