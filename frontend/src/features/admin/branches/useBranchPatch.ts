import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/design';
import { adminBranchesApi, type AdminBranch, type AdminBranchInput } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { qk } from '@/lib/api/keys';
import { errorText } from '../catalog-kit/errors';

type Switchable = 'accepting_orders' | 'pickup_enabled' | 'delivery_enabled';

const MESSAGES: Record<Switchable, (name: string, on: boolean) => string> = {
  accepting_orders: (n, on) => (on ? `${n} is taking orders again.` : `Orders are paused at ${n}.`),
  pickup_enabled: (n, on) => `Pickup is ${on ? 'on' : 'off'} at ${n}.`,
  delivery_enabled: (n, on) => `Delivery is ${on ? 'on' : 'off'} at ${n}.`,
};

/** Immediate on/off switches for a branch (optimistic; rolls back and explains on failure). */
export function useBranchSwitch(branch: AdminBranch) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ field, value }: { field: Switchable; value: boolean }) =>
      adminBranchesApi.update(branch.id, { [field]: value } as AdminBranchInput),
    onMutate: async ({ field, value }) => {
      await qc.cancelQueries({ queryKey: aqk.branches.list });
      const previous = qc.getQueryData<AdminBranch[]>(aqk.branches.list);
      qc.setQueryData<AdminBranch[]>(aqk.branches.list, (old) =>
        old?.map((b) => (b.id === branch.id ? { ...b, [field]: value } : b)),
      );
      return { previous };
    },
    onError: (e, { field }, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.branches.list, ctx.previous);
      toast.error(
        `Could not change ${field.replace(/_/g, ' ')} for ${branch.name}. ${errorText(e)}`,
      );
    },
    onSuccess: (_d, { field, value }) => toast.success(MESSAGES[field](branch.name, value)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: aqk.branches.all });
      void qc.invalidateQueries({ queryKey: qk.branches.all });
    },
  });
}
