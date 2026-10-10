import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Ban, CircleCheckBig, Pencil, Plus, Search, UserCog } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  type Column,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { PAGE_SIZE, useAdminStaff, useRoleMatrix, useSetStaffActive } from '@/lib/api/adminPeople';
import { describeError, isApiError } from '@/lib/api/errors';
import type { AdminStaffMember } from '@/lib/api/peopleTypes';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { Callout } from '../../people-kit/Callout';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { formatRelative } from '../../people-kit/datetime';
import { useDebouncedSearch, useListState } from '../../people-kit/useListState';
import { RoleMatrixTable } from '../components/RoleMatrixTable';
import { StaffDialog } from '../components/StaffDialog';

const FILTERS = ['role', 'is_active'] as const;

const STATUS_OPTIONS = [
  { value: 'all', label: 'Active and inactive' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];

export default function StaffPage() {
  useSeo({ title: 'Staff & permissions', noindex: true });
  const { user, staff, hasCapability } = useAuth();
  const { params, update, setPage } = useListState(FILTERS);
  const query = useAdminStaff(params);
  const roles = useRoleMatrix();
  const toggle = useSetStaffActive();
  const [text, setText] = useDebouncedSearch(params.search ?? '', (v) =>
    update({ search: v || undefined }),
  );
  const [editing, setEditing] = useState<AdminStaffMember | 'new' | null>(null);
  const [toggling, setToggling] = useState<AdminStaffMember | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'roles' ? 'roles' : 'team';
  const setTab = (v: string) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === 'roles') next.set('tab', 'roles');
        else next.delete('tab');
        return next;
      },
      { replace: true },
    );

  const globalRoles = useMemo(
    () => new Set((roles.data?.roles ?? []).filter((r) => r.is_global).map((r) => r.role)),
    [roles.data],
  );
  const actorIsSuper = staff?.role === 'SUPER_ADMIN';
  const total = query.data?.count ?? 0;
  const page = params.page ?? 1;

  /** Why an activate/deactivate action is unavailable (the server enforces the same rules). */
  const blockReason = (m: AdminStaffMember): string | null => {
    if (m.is_active && m.id === user?.id) return 'You cannot deactivate your own account.';
    if (m.role === 'SUPER_ADMIN' && !actorIsSuper)
      return `Only a super admin can ${m.is_active ? 'deactivate' : 'reactivate'} a super admin.`;
    return null;
  };

  const columns: Column<AdminStaffMember>[] = [
    {
      id: 'name',
      header: 'Team member',
      primary: true,
      sortable: true,
      sortKey: 'last_name',
      cell: (m) => (
        <div className="min-w-0">
          <span className="font-medium">
            {`${m.first_name} ${m.last_name}`.trim() || m.email}
            {m.id === user?.id ? (
              <Badge tone="outline" size="sm" className="ml-2 align-middle">
                You
              </Badge>
            ) : null}
          </span>
          <div className="truncate text-sm text-text-muted">{m.email}</div>
          {m.job_title ? <div className="text-sm text-text-muted">{m.job_title}</div> : null}
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (m) => <span className="font-medium">{m.role_label}</span>,
    },
    {
      id: 'branches',
      header: 'Branches',
      hideOnNarrow: false,
      cell: (m) =>
        globalRoles.has(m.role) || m.branches.length === 0 ? (
          <span className="text-text-muted">
            {globalRoles.has(m.role) ? 'All branches' : 'No branch limit'}
          </span>
        ) : (
          (m.branches as { id: number; name: string }[]).map((b) => b.name).join(', ')
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (m) =>
        m.is_active ? (
          <Badge tone="success">
            <CircleCheckBig aria-hidden="true" />
            Active
          </Badge>
        ) : (
          <Badge tone="neutral">
            <Ban aria-hidden="true" />
            Deactivated
          </Badge>
        ),
    },
    {
      id: 'last_login',
      header: 'Last sign-in',
      className: 'whitespace-nowrap',
      sortable: true,
      cell: (m) => formatRelative(m.last_login),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      narrowLabel: 'Actions',
      align: 'right',
      cell: (m) => {
        const reason = blockReason(m);
        const name = `${m.first_name} ${m.last_name}`.trim() || m.email;
        return (
          <div className="flex justify-end gap-1.5 whitespace-nowrap">
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Pencil aria-hidden="true" className="size-3.5" />}
              onClick={() => setEditing(m)}
              aria-label={`Edit ${name}`}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(reason)}
              title={reason ?? undefined}
              aria-label={`${m.is_active ? 'Deactivate' : 'Reactivate'} ${name}${reason ? `. ${reason}` : ''}`}
              onClick={() => {
                setToggleError(null);
                setToggling(m);
              }}
            >
              {m.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        );
      },
    },
  ];

  const roleOptions = [
    { value: 'all', label: 'All roles' },
    ...(roles.data?.roles ?? []).map((r) => ({ value: r.role, label: r.label })),
  ];

  const confirmToggle = async () => {
    if (!toggling) return;
    setToggleError(null);
    const target = toggling;
    try {
      await toggle.mutateAsync({ id: target.id, active: !target.is_active });
      toast.success(
        `${`${target.first_name} ${target.last_name}`.trim() || target.email} was ${target.is_active ? 'deactivated' : 'reactivated'}.`,
      );
      setToggling(null);
    } catch (e) {
      setToggleError(isApiError(e) ? e.message : describeError(e).message);
    }
  };

  return (
    <div>
      <AdminPageHeader
        title="Staff & permissions"
        description="Who can sign in to this dashboard, and what each role is allowed to do. Every change here is recorded in the audit log."
        actions={
          <Button
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            size="sm"
            onClick={() => setEditing('new')}
          >
            Add staff member
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Staff sections">
          <TabsTrigger value="team">Team members</TabsTrigger>
          <TabsTrigger value="roles">Roles and permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="team">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-72">
              <label htmlFor="staff-search" className="sr-only">
                Search staff by name or email
              </label>
              <Input
                id="staff-search"
                type="search"
                size="sm"
                leading={<Search aria-hidden="true" />}
                placeholder="Search name or email"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <div className="w-48">
              <Select
                size="sm"
                aria-label="Filter by role"
                options={roleOptions}
                value={(params.role as string | undefined) ?? 'all'}
                onValueChange={(v) => update({ role: v === 'all' ? undefined : v })}
              />
            </div>
            <div className="w-48">
              <Select
                size="sm"
                aria-label="Filter by status"
                options={STATUS_OPTIONS}
                value={(params.is_active as string | undefined) ?? 'all'}
                onValueChange={(v) => update({ is_active: v === 'all' ? undefined : v })}
              />
            </div>
            <p className="ml-auto text-sm text-text-muted" aria-live="polite">
              {query.data ? `${total} team member${total === 1 ? '' : 's'}` : ''}
            </p>
          </div>

          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <>
              <DataTable
                caption="Staff accounts"
                columns={columns}
                data={query.data?.results}
                getRowId={(m) => m.id}
                loading={query.isPending}
                sort={
                  params.ordering
                    ? {
                        key: String(params.ordering).replace(/^-/, ''),
                        direction: String(params.ordering).startsWith('-') ? 'desc' : 'asc',
                      }
                    : null
                }
                onSortChange={(s) =>
                  update({
                    ordering: s ? `${s.direction === 'desc' ? '-' : ''}${s.key}` : undefined,
                  })
                }
                empty={
                  <EmptyState
                    icon={<UserCog aria-hidden="true" />}
                    title="No staff match"
                    description="Try a different search or clear the filters."
                  />
                }
              />
              <Pagination
                className="mt-4"
                page={page}
                pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                onPageChange={setPage}
              />
            </>
          )}
          {hasCapability('audit.view') ? (
            <p className="mt-4 text-sm text-text-muted">
              Looking for who changed what?{' '}
              <Link
                className="text-accent-text underline underline-offset-4"
                to="/admin/audit-log?resource_type=accounts.User"
              >
                See account changes in the audit log
              </Link>
              .
            </p>
          ) : null}
        </TabsContent>

        <TabsContent value="roles">
          <Callout className="mb-4" title="How permissions work">
            Each person has exactly one role. Roles that are limited to branches only see orders,
            stock and hours for the branches they are assigned to. Only a super admin can create
            another super admin.
          </Callout>
          {roles.isError ? (
            <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
          ) : (
            <RoleMatrixTable matrix={roles.data} />
          )}
        </TabsContent>
      </Tabs>

      <StaffDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        member={editing && editing !== 'new' ? editing : undefined}
      />

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => {
          if (!o) {
            setToggling(null);
            setToggleError(null);
          }
        }}
        title={
          toggling?.is_active
            ? `Deactivate ${toggling.first_name || toggling.email}?`
            : `Reactivate ${toggling?.first_name || toggling?.email}?`
        }
        description={
          toggling?.is_active
            ? 'They will no longer be able to sign in. Their history and audit entries are kept.'
            : 'They will be able to sign in again with their previous role and branches.'
        }
        confirmLabel={toggling?.is_active ? 'Deactivate' : 'Reactivate'}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        loading={toggle.isPending}
        error={toggleError}
        onConfirm={confirmToggle}
      />
    </div>
  );
}
