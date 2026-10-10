import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Badge, Button, EmptyState, ErrorState, Skeleton, toast } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import {
  adminCatalogApi,
  useAdminCollections,
  useInvalidateCatalog,
  type AdminCollection,
} from '@/lib/api/adminCatalog';
import { aqk } from '@/lib/api/adminKeys';
import { cn } from '@/lib/cn';
import { errorText } from '../../catalog-kit/errors';
import { PageHeader } from '../../catalog-kit/PageHeader';
import { SortableList } from '../../catalog-kit/SortableList';
import { useUrlState } from '../../catalog-kit/useUrlState';
import { CollectionEditor } from '../components/CollectionEditor';

export default function AdminCollectionsPage() {
  useSeo({ title: 'Collections · Admin', noindex: true });
  const { hasCapability } = useAuth();
  const canManage = hasCapability('catalog.manage');
  const { get, set } = useUrlState();
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();
  const collections = useAdminCollections();
  const selected = get('collection');
  const current =
    selected && selected !== 'new'
      ? collections.data?.find((c) => String(c.id) === selected)
      : null;

  const reorder = useMutation({
    mutationFn: (next: AdminCollection[]) =>
      adminCatalogApi.reorderCollections(next.map((c) => c.id)),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: aqk.collections.all });
      const previous = qc.getQueryData<AdminCollection[]>(aqk.collections.all);
      qc.setQueryData(aqk.collections.all, next);
      return { previous };
    },
    onError: (e, _n, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.collections.all, ctx.previous);
      toast.error(`Could not save the new order. ${errorText(e)}`);
    },
    onSuccess: () => toast.success('Collection order saved.'),
    onSettled: () => void invalidate(['collections']),
  });

  return (
    <div>
      <PageHeader
        title="Collections"
        description="Hand-picked, ordered product lists such as Bestsellers or the Seasonal menu."
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => set({ collection: 'new' })}
            >
              New collection
            </Button>
          ) : null
        }
      />
      {collections.isError ? (
        <ErrorState error={collections.error} onRetry={() => void collections.refetch()} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section
            aria-label="Collections"
            className={cn('content-start', selected && 'max-lg:hidden')}
          >
            {collections.isPending ? (
              <div className="grid gap-2" aria-busy="true">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : collections.data.length === 0 ? (
              <EmptyState
                title="No collections yet"
                description="Create one to curate a list of products."
              />
            ) : (
              <SortableList
                label="Collections"
                items={collections.data}
                getId={(c) => c.id}
                getLabel={(c) => c.name}
                disabled={!canManage || reorder.isPending}
                onReorder={(next) => reorder.mutate(next)}
                renderItem={(c) => (
                  <button
                    type="button"
                    onClick={() => set({ collection: c.id })}
                    aria-current={String(c.id) === selected ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-sunken',
                      String(c.id) === selected && 'bg-accent-soft',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {c.name}
                      {!c.is_active ? <Badge size="sm">Hidden</Badge> : null}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {c.product_count} product{c.product_count === 1 ? '' : 's'}
                    </span>
                  </button>
                )}
              />
            )}
          </section>
          <section aria-label="Collection editor" className={cn(!selected && 'max-lg:hidden')}>
            {selected ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-3 lg:hidden"
                  onClick={() => set({ collection: null })}
                >
                  Back to collections
                </Button>
                {selected === 'new' ? (
                  <CollectionEditor
                    key="new"
                    collection={null}
                    canManage={canManage}
                    onCreated={(id) => set({ collection: id })}
                    onDeleted={() => set({ collection: null })}
                  />
                ) : current ? (
                  <CollectionEditor
                    key={`${current.id}-${current.product_ids.join(',')}`}
                    collection={current}
                    canManage={canManage}
                    onCreated={() => undefined}
                    onDeleted={() => set({ collection: null })}
                  />
                ) : collections.isPending ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <EmptyState
                    title="Collection not found"
                    description="It may have been deleted."
                  />
                )}
              </>
            ) : (
              <EmptyState
                title="Choose a collection"
                description="Select one to edit it, or create a new collection."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
