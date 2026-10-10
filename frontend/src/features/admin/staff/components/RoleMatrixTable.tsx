import { Check, Minus } from 'lucide-react';
import { Badge, Skeleton } from '@/design';
import type { RoleMatrix } from '@/lib/api/peopleTypes';
import { cn } from '@/lib/cn';
import { branchScopeLabel, capabilityLabel, groupCapabilities } from '../capabilityLabels';

/**
 * Roles (columns) × capabilities (rows, grouped by area). Every cell is an icon plus visually hidden text, so the
 * table reads the same for screen readers and works without colour.
 */
export function RoleMatrixTable({
  matrix,
  highlightRole,
}: {
  matrix: RoleMatrix | undefined;
  highlightRole?: string;
}) {
  if (!matrix) return <Skeleton className="h-64 w-full" />;
  const groups = groupCapabilities(matrix.capabilities);
  const sets = new Map(matrix.roles.map((r) => [r.role, new Set(r.capabilities)]));
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">What each staff role is allowed to do</caption>
        <thead>
          <tr className="bg-surface-sunken">
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-56 bg-surface-sunken px-4 py-3 text-left text-xs font-semibold tracking-wide text-text-muted uppercase"
            >
              Can…
            </th>
            {matrix.roles.map((r) => (
              <th
                key={r.role}
                scope="col"
                className={cn(
                  'px-3 py-3 text-center align-bottom text-xs font-semibold',
                  highlightRole === r.role && 'bg-accent-soft',
                )}
              >
                <span className="block text-text">{r.label}</span>
                <Badge tone="outline" size="sm" className="mt-1.5 font-normal">
                  {branchScopeLabel(r)}
                </Badge>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.group}>
            <tr>
              <th
                scope="colgroup"
                colSpan={matrix.roles.length + 1}
                className="border-y border-border bg-surface px-4 py-1.5 text-left text-xs font-semibold tracking-wide text-text-muted uppercase"
              >
                {g.label}
              </th>
            </tr>
            {g.capabilities.map((c) => (
              <tr key={c} className="border-b border-border last:border-0">
                <th
                  scope="row"
                  className="sticky left-0 bg-surface-raised px-4 py-2 text-left font-normal"
                >
                  {capabilityLabel(c)}
                </th>
                {matrix.roles.map((r) => {
                  const allowed = sets.get(r.role)?.has(c) ?? false;
                  return (
                    <td
                      key={r.role}
                      className={cn(
                        'px-3 py-2 text-center',
                        highlightRole === r.role && 'bg-accent-soft/60',
                      )}
                    >
                      {allowed ? (
                        <Check aria-hidden="true" className="mx-auto size-4 text-success" />
                      ) : (
                        <Minus aria-hidden="true" className="mx-auto size-4 text-text-muted/60" />
                      )}
                      <span className="sr-only">{allowed ? 'Allowed' : 'Not allowed'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
