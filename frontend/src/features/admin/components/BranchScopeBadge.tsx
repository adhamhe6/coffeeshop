import { Store } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useBranchOptions } from '@/lib/api/adminReports';

/** Which branches this staff member's numbers and orders cover ("All branches" or the names they are limited to). */
export function BranchScopeBadge() {
  const { staff } = useAuth();
  const { data: branches } = useBranchOptions();
  if (!staff) return null;
  const all = staff.branch_ids === null;
  const names = (branches ?? []).map((b) => b.name);
  const label = all ? 'All branches' : names.length ? names.join(', ') : 'Your branches';
  return (
    <p
      className="inline-flex max-w-56 items-center gap-1.5 rounded-pill border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted"
      title={all ? 'You can see every branch' : `Limited to: ${label}`}
    >
      <Store aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">Branch scope: </span>
      <span className="truncate">{label}</span>
    </p>
  );
}
