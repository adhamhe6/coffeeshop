import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Skeleton,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { adminBranchesApi, type AdminBranch, type Closure } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { qk } from '@/lib/api/keys';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { errorText, fieldError } from '../../catalog-kit/errors';

const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );

export function ClosuresPanel({ branch, canManage }: { branch: AdminBranch; canManage: boolean }) {
  const qc = useQueryClient();
  const closures = useQuery({
    queryKey: aqk.branches.closures(branch.id),
    queryFn: () => adminBranchesApi.closures(branch.id),
  });
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ start?: string; end?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Closure | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: aqk.branches.closures(branch.id) });
    void qc.invalidateQueries({ queryKey: qk.branches.all });
  };

  const add = useMutation({
    mutationFn: () =>
      adminBranchesApi.addClosure(branch.id, {
        start_date: start,
        end_date: end || start,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Closure added. Customers cannot order for these dates.');
      setStart('');
      setEnd('');
      setReason('');
      refresh();
    },
    onError: (e) => {
      setErrors({ start: fieldError(e, 'start_date'), end: fieldError(e, 'end_date') });
      if (!fieldError(e, 'start_date') && !fieldError(e, 'end_date')) setFormError(errorText(e));
    },
  });

  const submit = () => {
    setFormError(null);
    const next: typeof errors = {};
    if (!start) next.start = 'Choose the first closed date.';
    if (end && start && end < start) next.end = 'The end date cannot be before the start date.';
    setErrors(next);
    if (Object.keys(next).length) return;
    add.mutate();
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-text-muted">
        Closures override the weekly hours: the branch cannot take orders on these dates (holidays,
        refits).
      </p>
      {canManage ? (
        <form
          className="grid gap-3 rounded-lg border border-border bg-surface-raised p-3 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
          aria-label="Add a closure"
        >
          <Field label="First closed day" required error={errors.start}>
            <Input type="date" size="sm" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Last closed day" error={errors.end} hint="Blank = one day.">
            <Input type="date" size="sm" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Reason" hint="Shown to staff only.">
            <Input
              size="sm"
              value={reason}
              maxLength={120}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="sm:mt-7">
            <Button type="submit" size="sm" loading={add.isPending}>
              Add closure
            </Button>
          </div>
          {formError ? (
            <div className="sm:col-span-4">
              <FormAlert>{formError}</FormAlert>
            </div>
          ) : null}
        </form>
      ) : null}
      {closures.isError ? (
        <ErrorState error={closures.error} onRetry={() => void closures.refetch()} />
      ) : !closures.data ? (
        <Skeleton className="h-24 w-full" />
      ) : closures.data.length === 0 ? (
        <EmptyState
          title="No closures planned"
          description="Add one when the branch will be shut on a normal opening day."
        />
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border bg-surface-raised"
          aria-label="Planned closures"
        >
          {closures.data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.start_date === c.end_date
                    ? fmt(c.start_date)
                    : `${fmt(c.start_date)} to ${fmt(c.end_date)}`}
                </p>
                {c.reason ? <p className="text-sm text-text-muted">{c.reason}</p> : null}
              </div>
              {canManage ? (
                <IconButton
                  label={`Remove closure starting ${fmt(c.start_date)}`}
                  size="icon-sm"
                  onClick={() => setRemoving(c)}
                  icon={<Trash2 aria-hidden="true" className="size-4" />}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this closure?"
        description="The branch will be open again on these dates, following the weekly hours."
        confirmLabel="Remove closure"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await adminBranchesApi.removeClosure(branch.id, removing.id);
          toast.success('Closure removed.');
          refresh();
        }}
      />
    </div>
  );
}
