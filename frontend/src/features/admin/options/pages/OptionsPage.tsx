import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useAdminGroups } from '@/lib/api/adminCatalog';
import { cn } from '@/lib/cn';
import { PageHeader } from '../../catalog-kit/PageHeader';
import { useUrlState } from '../../catalog-kit/useUrlState';
import { GroupEditor } from '../components/GroupEditor';
import { selectionHint } from '../groupRules';

export default function AdminOptionsPage() {
  useSeo({ title: 'Options · Admin', noindex: true });
  const { hasCapability } = useAuth();
  const canManage = hasCapability('catalog.manage');
  const { get, set } = useUrlState();
  const groups = useAdminGroups();
  const [q, setQ] = useState('');
  const selected = get('group');
  const list = (groups.data ?? []).filter((g) =>
    `${g.name} ${g.display_name}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const current =
    selected && selected !== 'new' ? groups.data?.find((g) => String(g.id) === selected) : null;

  return (
    <div>
      <PageHeader
        title="Options"
        description="Reusable groups of choices (size, milk, extras) that you attach to products."
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => set({ group: 'new' })}
            >
              New group
            </Button>
          ) : null
        }
      />
      {groups.isError ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <section
            aria-label="Option groups"
            className={cn('grid content-start gap-3', selected && 'max-lg:hidden')}
          >
            <div>
              <label htmlFor="group-search" className="sr-only">
                Search option groups
              </label>
              <Input
                id="group-search"
                type="search"
                size="sm"
                placeholder="Search groups"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                leading={<Search aria-hidden="true" />}
              />
            </div>
            {groups.isPending ? (
              <div className="grid gap-2" aria-busy="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                title="No groups found"
                description={q ? 'Try another search.' : 'Create your first group.'}
              />
            ) : (
              <ul className="grid gap-1.5">
                {list.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => set({ group: g.id })}
                      aria-current={String(g.id) === selected ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-md border border-border bg-surface-raised p-3 text-left hover:border-border-strong',
                        String(g.id) === selected && 'border-accent bg-accent-soft',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{g.name}</span>
                        {!g.is_active ? <Badge size="sm">Inactive</Badge> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {selectionHint(g)} · {g.options.length} option
                        {g.options.length === 1 ? '' : 's'} · used by {g.product_count} product
                        {g.product_count === 1 ? '' : 's'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Group editor" className={cn(!selected && 'max-lg:hidden')}>
            {selected ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-3 lg:hidden"
                  onClick={() => set({ group: null })}
                >
                  Back to groups
                </Button>
                {selected === 'new' ? (
                  <GroupEditor
                    key="new"
                    group={null}
                    canManage={canManage}
                    onCreated={(id) => set({ group: id })}
                    onDeleted={() => set({ group: null })}
                  />
                ) : current ? (
                  <GroupEditor
                    key={current.id}
                    group={current}
                    canManage={canManage}
                    onCreated={() => undefined}
                    onDeleted={() => set({ group: null })}
                  />
                ) : groups.isPending ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <EmptyState title="Group not found" description="It may have been deleted." />
                )}
              </>
            ) : (
              <EmptyState
                title="Choose a group"
                description="Select a group to edit its options, or create a new one."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
