import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ProductImage,
  Skeleton,
  toast,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import {
  adminCatalogApi,
  useAdminCategories,
  useInvalidateCatalog,
  type AdminCategory,
} from '@/lib/api/adminCatalog';
import { aqk } from '@/lib/api/adminKeys';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { errorText } from '../../catalog-kit/errors';
import { MiniSwitch } from '../../catalog-kit/MiniSwitch';
import { PageHeader } from '../../catalog-kit/PageHeader';
import { SortableList } from '../../catalog-kit/SortableList';
import { CategoryDialog } from '../components/CategoryDialog';

export default function AdminCategoriesPage() {
  useSeo({ title: 'Categories · Admin', noindex: true });
  const { hasCapability } = useAuth();
  const canManage = hasCapability('catalog.manage');
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();
  const categories = useAdminCategories();
  const [editing, setEditing] = useState<AdminCategory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);

  const patchCache = (fn: (list: AdminCategory[]) => AdminCategory[]) =>
    qc.setQueryData<AdminCategory[]>(aqk.categories.all, (old) => (old ? fn(old) : old));

  const reorder = useMutation({
    mutationFn: (next: AdminCategory[]) => adminCatalogApi.reorderCategories(next.map((c) => c.id)),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: aqk.categories.all });
      const previous = qc.getQueryData<AdminCategory[]>(aqk.categories.all);
      patchCache(() => next);
      return { previous };
    },
    onError: (e, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.categories.all, ctx.previous);
      toast.error(`Could not save the new order. ${errorText(e)}`);
    },
    onSuccess: () => toast.success('Category order saved.'),
    onSettled: () => void invalidate(['categories']),
  });

  const toggle = useMutation({
    mutationFn: (v: { c: AdminCategory; field: 'is_active' | 'is_featured'; value: boolean }) =>
      adminCatalogApi.updateCategory(v.c.id, { [v.field]: v.value }),
    onMutate: async ({ c, field, value }) => {
      await qc.cancelQueries({ queryKey: aqk.categories.all });
      const previous = qc.getQueryData<AdminCategory[]>(aqk.categories.all);
      patchCache((list) => list.map((x) => (x.id === c.id ? { ...x, [field]: value } : x)));
      return { previous };
    },
    onError: (e, { c }, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.categories.all, ctx.previous);
      toast.error(`Could not update ${c.name}. ${errorText(e)}`);
    },
    onSuccess: (_d, { c, field, value }) =>
      toast.success(
        field === 'is_active'
          ? `${c.name} is ${value ? 'visible' : 'hidden'} on the storefront.`
          : `${c.name} is ${value ? 'featured' : 'no longer featured'}.`,
      ),
    onSettled: () => void invalidate(['categories']),
  });

  const list = categories.data;

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Order the menu sections. Use the arrows or drag a row; the storefront follows this order."
        actions={
          canManage ? (
            <Button
              onClick={() => setEditing('new')}
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            >
              New category
            </Button>
          ) : null
        }
      />

      {categories.isError ? (
        <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />
      ) : !list ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create a category before adding products."
          action={
            canManage ? <Button onClick={() => setEditing('new')}>New category</Button> : undefined
          }
        />
      ) : (
        <SortableList
          label="Categories"
          items={list}
          getId={(c) => c.id}
          getLabel={(c) => c.name}
          disabled={!canManage || reorder.isPending}
          onReorder={(next) => reorder.mutate(next)}
          renderItem={(c) => (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ProductImage src={c.image} alt="" aspect="3/2" className="w-16 shrink-0" />
              <div className="min-w-40 flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-text-muted">
                  <span className="font-mono">/{c.slug}</span> · {c.active_product_count} active of{' '}
                  {c.product_count} product{c.product_count === 1 ? '' : 's'}
                </p>
              </div>
              {!c.is_active ? <Badge tone="neutral">Hidden</Badge> : null}
              <MiniSwitch
                checked={c.is_active}
                disabled={!canManage}
                label={`Visible: ${c.name}`}
                onCheckedChange={(v) => toggle.mutate({ c, field: 'is_active', value: v })}
                text="Visible"
              />
              <MiniSwitch
                checked={c.is_featured}
                disabled={!canManage}
                label={`Featured: ${c.name}`}
                onCheckedChange={(v) => toggle.mutate({ c, field: 'is_featured', value: v })}
                text="Featured"
              />
              {canManage ? (
                <div className="flex gap-1">
                  <IconButton
                    label={`Edit ${c.name}`}
                    size="icon-sm"
                    variant="secondary"
                    onClick={() => setEditing(c)}
                    icon={<Pencil aria-hidden="true" className="size-4" />}
                  />
                  <IconButton
                    label={`Delete ${c.name}`}
                    size="icon-sm"
                    onClick={() => setDeleting(c)}
                    icon={<Trash2 aria-hidden="true" className="size-4" />}
                  />
                </div>
              ) : null}
            </div>
          )}
        />
      )}

      {editing ? (
        <CategoryDialog
          open
          category={editing === 'new' ? null : editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'category'}?`}
        description={
          deleting && deleting.product_count > 0
            ? `This category still has ${deleting.product_count} product(s), so it cannot be deleted. Move or archive them first, or switch the category to hidden.`
            : 'The category is removed permanently. This cannot be undone.'
        }
        confirmLabel="Delete category"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await adminCatalogApi.deleteCategory(deleting.id);
          await invalidate(['categories']);
          toast.success(`${deleting.name} was deleted.`);
        }}
      />
    </div>
  );
}
