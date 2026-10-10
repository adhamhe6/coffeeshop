import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { CartIssue } from '@/lib/api/types';
import { cn } from '@/lib/cn';

/** Codes that are about choices still to be made at checkout, not a problem with the cart itself. */
export const CHOICE_CODES = new Set(['branch_required', 'address_required']);

/**
 * Server `issues[]` / `checkout_blockers[]` rendered as plain sentences. Errors block checkout; warnings inform.
 * Severity is carried by the icon and the lead-in word as well as the colour.
 */
export function IssueList({
  issues,
  className,
  title,
}: {
  issues: CartIssue[];
  className?: string;
  title?: string;
}) {
  if (issues.length === 0) return null;
  return (
    <div role="alert" className={cn('grid gap-2', className)} data-testid="issue-list">
      {title ? <p className="text-sm font-semibold">{title}</p> : null}
      <ul className="grid gap-2">
        {issues.map((issue, i) => {
          const error = issue.severity !== 'warning';
          const Icon = error ? TriangleAlert : CircleAlert;
          return (
            <li
              key={`${issue.code}-${issue.item_id ?? ''}-${i}`}
              className={cn(
                'flex items-start gap-2.5 rounded-md border p-3 text-sm font-medium',
                error
                  ? 'border-danger/30 bg-danger-bg text-danger'
                  : 'border-warning/30 bg-warning-bg text-warning',
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="sr-only">{error ? 'Problem: ' : 'Notice: '}</span>
                {issue.message}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
