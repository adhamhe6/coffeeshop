import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { Button, Skeleton, ErrorState, toast } from '@/design';
import { adminBranchesApi, type AdminBranch } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';
import { FormAlert } from '@/features/account/components/FormAlert';
import { errorText } from '../../catalog-kit/errors';
import { MiniSwitch } from '../../catalog-kit/MiniSwitch';
import {
  copyDay,
  DAYS,
  fromApi,
  sameHours,
  toRequest,
  validateWeek,
  type DayHours,
} from '../hoursRules';

export function HoursEditor({ branch, canManage }: { branch: AdminBranch; canManage: boolean }) {
  const hours = useQuery({
    queryKey: aqk.branches.hours(branch.id),
    queryFn: () => adminBranchesApi.hours(branch.id),
  });
  if (hours.isError) return <ErrorState error={hours.error} onRetry={() => void hours.refetch()} />;
  if (!hours.data) return <Skeleton className="h-72 w-full" />;
  return (
    <HoursForm
      key={JSON.stringify(hours.data)}
      branch={branch}
      initial={fromApi(hours.data)}
      canManage={canManage}
    />
  );
}

function HoursForm({
  branch,
  initial,
  canManage,
}: {
  branch: AdminBranch;
  initial: DayHours[];
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [days, setDays] = useState(initial);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateWeek(days);
  const dirty = !sameHours(days, initial);

  const update = (weekday: number, patch: Partial<DayHours>) => {
    setDays((list) => list.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
    setError(null);
  };

  const save = async () => {
    setShown(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    try {
      await adminBranchesApi.saveHours(branch.id, toRequest(days));
      await qc.invalidateQueries({ queryKey: aqk.branches.all });
      void qc.invalidateQueries({ queryKey: qk.branches.all });
      toast.success(`Opening hours of ${branch.name} saved.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-text-muted">
        Times are in the branch time zone ({branch.timezone}). A closing time must be later than the
        opening time on the same day; overnight hours are not supported.
      </p>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <ul
        className="divide-y divide-border rounded-lg border border-border bg-surface-raised"
        aria-label="Opening hours"
      >
        {days.map((d) => {
          const live = !d.is_closed && d.opens && d.closes ? errors[d.weekday] : undefined;
          const problem = shown ? errors[d.weekday] : live;
          return (
            <li
              key={d.weekday}
              className="grid gap-2 px-3 py-2.5 sm:grid-cols-[8rem_9rem_1fr_auto] sm:items-center"
            >
              <span className="font-medium">{DAYS[d.weekday]}</span>
              <MiniSwitch
                text={d.is_closed ? 'Closed' : 'Open'}
                label={`${DAYS[d.weekday]} open`}
                checked={!d.is_closed}
                disabled={!canManage}
                onCheckedChange={(open) =>
                  update(d.weekday, {
                    is_closed: !open,
                    ...(open && !d.opens ? { opens: '07:00', closes: '18:00' } : {}),
                  })
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                {d.is_closed ? (
                  <span className="text-sm text-text-muted">Closed all day</span>
                ) : (
                  <>
                    <label className="sr-only" htmlFor={`opens-${d.weekday}`}>
                      {DAYS[d.weekday]} opens
                    </label>
                    <input
                      id={`opens-${d.weekday}`}
                      type="time"
                      value={d.opens}
                      disabled={!canManage}
                      aria-invalid={problem ? true : undefined}
                      onChange={(e) => update(d.weekday, { opens: e.target.value })}
                      className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm tabular-nums aria-[invalid=true]:border-danger"
                    />
                    <span aria-hidden="true">to</span>
                    <label className="sr-only" htmlFor={`closes-${d.weekday}`}>
                      {DAYS[d.weekday]} closes
                    </label>
                    <input
                      id={`closes-${d.weekday}`}
                      type="time"
                      value={d.closes}
                      disabled={!canManage}
                      aria-invalid={problem ? true : undefined}
                      onChange={(e) => update(d.weekday, { closes: e.target.value })}
                      className="h-9 rounded-md border border-border-strong bg-surface-raised px-2 text-sm tabular-nums aria-[invalid=true]:border-danger"
                    />
                  </>
                )}
                {problem ? (
                  <p role="alert" className="w-full text-sm font-medium text-danger">
                    {problem}
                  </p>
                ) : null}
              </div>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Copy ${DAYS[d.weekday]} hours to all days`}
                  leadingIcon={<Copy aria-hidden="true" className="size-4" />}
                  onClick={() => setDays((list) => copyDay(list, d.weekday))}
                >
                  Copy to all
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
            Save hours
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDays(initial)}>
              Discard changes
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-sm text-text-muted">
        After saving, the storefront location pages and checkout time slots use the new hours
        straight away.
      </p>
    </div>
  );
}
