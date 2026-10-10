import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { adminBranchesApi } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { cn } from '@/lib/cn';
import { PageHeader } from '../../catalog-kit/PageHeader';
import { useUrlState } from '../../catalog-kit/useUrlState';
import { BranchEditor } from '../components/BranchEditor';

export default function AdminBranchesPage() {
  useSeo({ title: 'Branches · Admin', noindex: true });
  const { hasCapability, staff } = useAuth();
  const canManage = hasCapability('branches.manage');
  const globalScope = staff?.branch_ids === null;
  const { get, set } = useUrlState();
  const branches = useQuery({ queryKey: aqk.branches.list, queryFn: adminBranchesApi.list });
  const list = branches.data;
  const selected = get('branch');

  // A single-branch manager has nothing to choose: open their branch directly.
  const onlyId = list && list.length === 1 ? list[0]?.id : undefined;
  useEffect(() => {
    if (onlyId !== undefined && !selected) set({ branch: onlyId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyId, selected]);

  // Wide screens show the list and the editor side by side, so open the first branch rather than an empty pane.
  const wide = useMediaQuery('(min-width: 1024px)');
  const firstId = list?.[0]?.id;
  useEffect(() => {
    if (wide && firstId !== undefined && !selected) set({ branch: firstId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, firstId, selected]);

  const current =
    selected && selected !== 'new' ? list?.find((b) => String(b.id) === selected) : undefined;
  const single = list?.length === 1;

  return (
    <div>
      <PageHeader
        title="Branches"
        description="Opening hours, ordering switches and delivery for each location."
        actions={
          canManage && globalScope ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => set({ branch: 'new' })}
            >
              New branch
            </Button>
          ) : null
        }
      />
      {branches.isError ? (
        <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />
      ) : (
        <div
          className={cn(
            'grid grid-cols-[minmax(0,1fr)] gap-5',
            !single && 'lg:grid-cols-[18rem_minmax(0,1fr)]',
          )}
        >
          {!single ? (
            <section
              aria-label="Branches"
              className={cn('content-start', selected && 'max-lg:hidden')}
            >
              {!list ? (
                <div className="grid gap-2" aria-busy="true">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : list.length === 0 ? (
                <EmptyState
                  title="No branches"
                  description="Create the first branch to start taking orders."
                />
              ) : (
                <ul className="grid gap-1.5">
                  {list.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => set({ branch: b.id })}
                        aria-current={String(b.id) === selected ? 'true' : undefined}
                        className={cn(
                          'w-full rounded-md border border-border bg-surface-raised p-3 text-left hover:border-border-strong',
                          String(b.id) === selected && 'border-accent bg-accent-soft',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{b.name}</span>
                          <span className="font-mono text-xs text-text-muted">{b.code}</span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {!b.is_active ? <Badge size="sm">Inactive</Badge> : null}
                          {b.is_active && !b.accepting_orders ? (
                            <Badge size="sm" tone="warning">
                              Orders paused
                            </Badge>
                          ) : null}
                          {b.is_active && b.accepting_orders ? (
                            <Badge size="sm" tone={b.is_open_now ? 'success' : 'neutral'}>
                              {b.is_open_now ? 'Open now' : 'Closed now'}
                            </Badge>
                          ) : null}
                          {b.is_placeholder_address ? (
                            <Badge size="sm" tone="outline">
                              Placeholder address
                            </Badge>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          <section
            aria-label="Branch editor"
            className={cn(!selected && !single && 'max-lg:hidden')}
          >
            {selected && !single ? (
              <Button
                variant="ghost"
                size="sm"
                className="mb-3 lg:hidden"
                onClick={() => set({ branch: null })}
              >
                Back to branches
              </Button>
            ) : null}
            {selected === 'new' && globalScope ? (
              <BranchEditor
                key="new"
                branch={null}
                onCreated={(id) => set({ branch: id })}
                onDeleted={() => set({ branch: null })}
              />
            ) : current ? (
              <BranchEditor
                key={current.id}
                branch={current}
                onCreated={() => undefined}
                onDeleted={() => set({ branch: null })}
              />
            ) : selected && !list ? (
              <Skeleton className="h-64 w-full" />
            ) : selected ? (
              <EmptyState
                title="Branch not found"
                description="It may have been deleted, or you may not have access to it."
              />
            ) : (
              <EmptyState
                title="Choose a branch"
                description="Select a branch to manage its hours, ordering and delivery."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
