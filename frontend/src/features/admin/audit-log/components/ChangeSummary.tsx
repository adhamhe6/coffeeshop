import { ArrowRight } from 'lucide-react';
import type { AuditLogEntry } from '@/lib/api/peopleTypes';
import { fieldLabel, normalizeChanges } from '../auditLogic';

/** Before/after table for an audit entry. Read-only; values are plain text, never HTML. */
export function ChangeSummary({ entry }: { entry: Pick<AuditLogEntry, 'action' | 'changes'> }) {
  const rows = normalizeChanges(entry.action, entry.changes);
  if (rows.length === 0)
    return (
      <p className="text-sm text-text-muted">
        No field-level details were recorded for this action.
      </p>
    );
  const hasDiff = rows.some((r) => r.kind === 'diff');
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">What changed</caption>
        <thead>
          <tr className="text-left text-xs tracking-wide text-text-muted uppercase">
            <th scope="col" className="py-1.5 pr-4 font-semibold">
              Field
            </th>
            {hasDiff ? (
              <>
                <th scope="col" className="py-1.5 pr-4 font-semibold">
                  Before
                </th>
                <th scope="col" className="py-1.5 font-semibold">
                  After
                </th>
              </>
            ) : (
              <th scope="col" className="py-1.5 font-semibold">
                Value
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.field} className="border-t border-border align-top">
              <th scope="row" className="py-1.5 pr-4 text-left font-medium">
                {r.kind === 'value' && r.field === 'Also updated' ? r.field : fieldLabel(r.field)}
              </th>
              {r.kind === 'diff' ? (
                <>
                  <td className="py-1.5 pr-4 break-words text-text-muted line-through decoration-1">
                    <span className="sr-only">Before: </span>
                    {r.from}
                  </td>
                  <td className="py-1.5 break-words">
                    <span className="inline-flex items-start gap-1.5">
                      <ArrowRight
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-text-muted"
                      />
                      <span>
                        <span className="sr-only">After: </span>
                        {r.to}
                      </span>
                    </span>
                  </td>
                </>
              ) : (
                <td colSpan={hasDiff ? 2 : 1} className="py-1.5 break-words">
                  {r.value}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
