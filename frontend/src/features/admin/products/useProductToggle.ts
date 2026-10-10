import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/design';
import { adminCatalogApi, type AdminProductRow } from '@/lib/api/adminCatalog';
import type { Paginated } from '@/lib/api/types';
import { aqk } from '@/lib/api/adminKeys';
import { qk } from '@/lib/api/keys';
import { errorText } from '../catalog-kit/errors';

export type ToggleField = 'is_active' | 'is_sold_out' | 'is_featured';

const MESSAGES: Record<ToggleField, (name: string, on: boolean) => string> = {
  is_active: (name, on) => (on ? `${name} is active again.` : `${name} is archived.`),
  is_sold_out: (name, on) => (on ? `${name} is marked sold out.` : `${name} is back on sale.`),
  is_featured: (name, on) => (on ? `${name} is featured.` : `${name} is no longer featured.`),
};

interface Vars {
  row: Pick<AdminProductRow, 'id' | 'name'>;
  field: ToggleField;
  value: boolean;
}

/**
 * Quick toggle with an optimistic update: every cached product list reflects the change immediately; if the request
 * fails the lists roll back to the snapshot and the reason is shown.
 */
export function useProductToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ row, field, value }: Vars) =>
      adminCatalogApi.updateProduct(row.id, { [field]: value }),
    onMutate: async ({ row, field, value }) => {
      await qc.cancelQueries({ queryKey: aqk.products.all });
      const snapshot = qc.getQueriesData<Paginated<AdminProductRow>>({
        queryKey: aqk.products.all,
      });
      qc.setQueriesData<Paginated<AdminProductRow>>(
        { queryKey: [...aqk.products.all, 'list'] },
        (old) =>
          old
            ? {
                ...old,
                results: old.results.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)),
              }
            : old,
      );
      return { snapshot };
    },
    onError: (error, { row, field }, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(`Could not update ${row.name}. ${errorText(error)}`, {
        id: `toggle-${row.id}-${field}`,
      });
    },
    onSuccess: (_data, { row, field, value }) => {
      toast.success(MESSAGES[field](row.name, value), { id: `toggle-${row.id}-${field}` });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: aqk.products.all });
      void qc.invalidateQueries({ queryKey: qk.products.all });
    },
  });
}
