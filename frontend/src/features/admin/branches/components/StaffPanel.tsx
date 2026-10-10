import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/design';
import { useAuth } from '@/app/auth';
import { adminBranchesApi, type AdminBranch } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  BRANCH_MANAGER: 'Branch manager',
  ORDER_MANAGER: 'Order manager',
  INVENTORY_MANAGER: 'Inventory manager',
  PRODUCT_MANAGER: 'Product manager',
  MARKETING_MANAGER: 'Marketing manager',
  SUPPORT_AGENT: 'Support agent',
};

/** Read-only: who is assigned to the branch. Assignments are changed on the Staff page. */
export function StaffPanel({ branch }: { branch: AdminBranch }) {
  const { hasCapability } = useAuth();
  const staff = useQuery({
    queryKey: aqk.branches.staff(branch.id),
    queryFn: () => adminBranchesApi.staff(branch.id),
  });
  const canOpenStaff = hasCapability('staff.manage');
  return (
    <div className="grid gap-3">
      <p className="text-sm text-text-muted">
        Staff assigned to {branch.name}. Administrators see every branch and are not listed here.{' '}
        {canOpenStaff ? (
          <>
            Change assignments on the{' '}
            <Link className="text-accent-text underline underline-offset-4" to="/admin/staff">
              Staff page
            </Link>
            .
          </>
        ) : (
          'Ask a super admin to change assignments.'
        )}
      </p>
      {staff.isError ? (
        <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />
      ) : !staff.data ? (
        <Skeleton className="h-24 w-full" />
      ) : staff.data.length === 0 ? (
        <EmptyState title="No staff assigned" description="Nobody is scoped to this branch yet." />
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border bg-surface-raised"
          aria-label="Assigned staff"
        >
          {staff.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.name}</p>
                <p className="text-sm text-text-muted">
                  {m.email}
                  {m.job_title ? ` · ${m.job_title}` : ''}
                </p>
              </div>
              <Badge tone="neutral">{ROLE_LABELS[m.role] ?? m.role}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
