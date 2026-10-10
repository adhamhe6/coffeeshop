import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Money,
  Select,
  Skeleton,
  Switch,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import {
  adminBranchesApi,
  type AdminBranch,
  type DeliveryZone,
  type ZoneLink,
} from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/api/keys';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { errorText } from '../../catalog-kit/errors';
import { MiniSwitch } from '../../catalog-kit/MiniSwitch';

const MONEY = /^\d{1,6}(\.\d{1,2})?$/;
export const validateFee = (v: string, optional = false): string | null =>
  v.trim() === ''
    ? optional
      ? null
      : 'Enter an amount (0 for none).'
    : MONEY.test(v.trim())
      ? null
      : 'Use a number like 3.50.';
export const validateEta = (v: string): string | null =>
  /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 240
    ? null
    : 'Enter minutes between 1 and 240.';

export function DeliveryPanel({
  branch,
  canManage,
  globalScope,
}: {
  branch: AdminBranch;
  canManage: boolean;
  globalScope: boolean;
}) {
  const qc = useQueryClient();
  const links = useQuery({
    queryKey: aqk.branches.zones(branch.id),
    queryFn: () => adminBranchesApi.zones(branch.id),
  });
  const [editing, setEditing] = useState<ZoneLink | 'new' | null>(null);
  const [removing, setRemoving] = useState<ZoneLink | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: aqk.branches.zones(branch.id) });
    void qc.invalidateQueries({ queryKey: aqk.zones.all });
    void qc.invalidateQueries({ queryKey: qk.branches.all });
  };

  const toggle = useMutation({
    mutationFn: ({ link, value }: { link: ZoneLink; value: boolean }) =>
      adminBranchesApi.updateZone(branch.id, link.id, { is_active: value }),
    onMutate: async ({ link, value }) => {
      await qc.cancelQueries({ queryKey: aqk.branches.zones(branch.id) });
      const previous = qc.getQueryData<ZoneLink[]>(aqk.branches.zones(branch.id));
      qc.setQueryData<ZoneLink[]>(aqk.branches.zones(branch.id), (old) =>
        old?.map((l) => (l.id === link.id ? { ...l, is_active: value } : l)),
      );
      return { previous };
    },
    onError: (e, { link }, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.branches.zones(branch.id), ctx.previous);
      toast.error(`Could not update ${link.zone_name}. ${errorText(e)}`);
    },
    onSuccess: (_d, { link, value }) =>
      toast.success(`Delivery to ${link.zone_name} is ${value ? 'on' : 'off'}.`),
    onSettled: refresh,
  });

  return (
    <div className="grid gap-6">
      {!branch.delivery_enabled ? (
        <p role="note" className="rounded-md border border-border bg-surface-sunken p-3 text-sm">
          Delivery is switched off for this branch, so these zones are not offered at checkout. Turn
          it on under Order controls above.
        </p>
      ) : null}
      <section aria-labelledby="zone-links-title" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="zone-links-title" className="font-display text-h4 font-semibold">
              Zones served by {branch.name}
            </h3>
            <p className="text-sm text-text-muted">
              Fee, minimum order and ETA are set per branch and zone.
            </p>
          </div>
          {canManage ? (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setEditing('new')}
            >
              Link a zone
            </Button>
          ) : null}
        </div>
        {links.isError ? (
          <ErrorState error={links.error} onRetry={() => void links.refetch()} />
        ) : !links.data ? (
          <Skeleton className="h-28 w-full" />
        ) : links.data.length === 0 ? (
          <EmptyState
            title="No zones linked"
            description="Link a delivery zone so customers in it can order delivery from this branch."
          />
        ) : (
          <ul
            className="divide-y divide-border rounded-lg border border-border bg-surface-raised"
            aria-label="Linked delivery zones"
          >
            {links.data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5">
                <div className="min-w-36 flex-1">
                  <p className="font-medium">
                    {l.zone_name}
                    {!l.zone_is_active ? (
                      <Badge size="sm" className="ml-2">
                        Zone inactive
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-sm text-text-muted">
                    Fee <Money value={l.fee} /> · minimum <Money value={l.min_order_total} /> ·{' '}
                    {l.free_delivery_over ? (
                      <>
                        free over <Money value={l.free_delivery_over} />
                      </>
                    ) : (
                      'no free-delivery threshold'
                    )}{' '}
                    · about {l.eta_minutes} min
                  </p>
                </div>
                <MiniSwitch
                  text="Active"
                  label={`Delivery to ${l.zone_name} active`}
                  checked={l.is_active}
                  disabled={!canManage}
                  onCheckedChange={(v) => toggle.mutate({ link: l, value: v })}
                />
                {canManage ? (
                  <div className="flex">
                    <IconButton
                      label={`Edit ${l.zone_name} terms`}
                      size="icon-sm"
                      onClick={() => setEditing(l)}
                      icon={<Pencil aria-hidden="true" className="size-4" />}
                    />
                    <IconButton
                      label={`Unlink ${l.zone_name}`}
                      size="icon-sm"
                      onClick={() => setRemoving(l)}
                      icon={<Trash2 aria-hidden="true" className="size-4" />}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {globalScope && canManage ? <ZoneManager /> : null}

      {editing ? (
        <ZoneLinkDialog
          branch={branch}
          link={editing === 'new' ? null : editing}
          linkedZoneIds={(links.data ?? []).map((l) => l.zone)}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Unlink ${removing?.zone_name ?? 'zone'}?`}
        description={`Customers in this zone can no longer order delivery from ${branch.name}. The zone itself is kept.`}
        confirmLabel="Unlink zone"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await adminBranchesApi.removeZone(branch.id, removing.id);
          toast.success(`${removing.zone_name} unlinked.`);
          refresh();
        }}
      />
    </div>
  );
}

function ZoneLinkDialog({
  branch,
  link,
  linkedZoneIds,
  onClose,
  onSaved,
}: {
  branch: AdminBranch;
  link: ZoneLink | null;
  linkedZoneIds: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const zones = useQuery({
    queryKey: aqk.zones.all,
    queryFn: adminBranchesApi.deliveryZones,
    enabled: link === null,
  });
  const [zone, setZone] = useState<string>(link ? String(link.zone) : '');
  const [fee, setFee] = useState(link?.fee ?? '');
  const [min, setMin] = useState(link?.min_order_total ?? '0.00');
  const [free, setFree] = useState(link?.free_delivery_over ?? '');
  const [eta, setEta] = useState(String(link?.eta_minutes ?? 30));
  const [active, setActive] = useState(link?.is_active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const next: Record<string, string> = {};
    if (!link && !zone) next.zone = 'Choose a zone.';
    const f = validateFee(fee);
    if (f) next.fee = f;
    const m = validateFee(min);
    if (m) next.min = m;
    const fr = validateFee(free, true);
    if (fr) next.free = fr;
    const e = validateEta(eta);
    if (e) next.eta = e;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setFormError(null);
    const body = {
      fee: fee.trim(),
      min_order_total: min.trim(),
      free_delivery_over: free.trim() === '' ? null : free.trim(),
      eta_minutes: Number(eta),
      is_active: active,
    };
    try {
      if (link) await adminBranchesApi.updateZone(branch.id, link.id, body);
      else await adminBranchesApi.addZone(branch.id, { ...body, zone: Number(zone) });
      toast.success('Delivery terms saved.');
      onSaved();
      onClose();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fields).length) {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields))
          map[
            k === 'min_order_total'
              ? 'min'
              : k === 'free_delivery_over'
                ? 'free'
                : k === 'eta_minutes'
                  ? 'eta'
                  : k
          ] = v[0] ?? '';
        setErrors(map);
      } else setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const available = (zones.data ?? []).filter((z) => !linkedZoneIds.includes(z.id));

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={link ? `${link.zone_name}: delivery terms` : 'Link a delivery zone'}
        description={`Terms for ${branch.name}. Amounts are in the store currency; the checkout applies them automatically.`}
      >
        <div className="grid gap-4">
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          {!link ? (
            <Field
              label="Zone"
              required
              error={errors.zone}
              hint={
                available.length === 0 && zones.isSuccess
                  ? 'Every zone is already linked.'
                  : undefined
              }
            >
              <Select
                value={zone || undefined}
                onValueChange={setZone}
                placeholder="Choose a zone"
                options={available.map((z) => ({ value: String(z.id), label: z.name }))}
              />
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery fee" required error={errors.fee}>
              <Input
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                inputMode="decimal"
                className="tabular-nums"
              />
            </Field>
            <Field label="Minimum order" required error={errors.min}>
              <Input
                value={min}
                onChange={(e) => setMin(e.target.value)}
                inputMode="decimal"
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Free delivery over"
              error={errors.free}
              hint="Optional: order subtotal that waives the fee."
            >
              <Input
                value={free}
                onChange={(e) => setFree(e.target.value)}
                inputMode="decimal"
                className="tabular-nums"
              />
            </Field>
            <Field label="Estimated time (minutes)" required error={errors.eta}>
              <Input value={eta} onChange={(e) => setEta(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <Switch
            label="Active"
            description="Off stops offering delivery to this zone from this branch."
            checked={active}
            onCheckedChange={setActive}
          />
        </div>
        <DialogFooter className="sticky -bottom-5 -mx-6 mt-5 -mb-5 bg-surface-raised">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save terms
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Zones are shared by every branch, so only administrators with access to all branches can edit them. */
function ZoneManager() {
  const qc = useQueryClient();
  const zones = useQuery({ queryKey: aqk.zones.all, queryFn: adminBranchesApi.deliveryZones });
  const [editing, setEditing] = useState<DeliveryZone | 'new' | null>(null);
  const [removing, setRemoving] = useState<DeliveryZone | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: aqk.zones.all });
    void qc.invalidateQueries({ queryKey: aqk.branches.all });
    void qc.invalidateQueries({ queryKey: qk.branches.all });
  };
  return (
    <section aria-labelledby="zones-title" className="grid gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="zones-title" className="font-display text-h4 font-semibold">
            All delivery zones
          </h3>
          <p className="text-sm text-text-muted">
            Shared by every branch. Link a zone to a branch above to serve it.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => setEditing('new')}
        >
          New zone
        </Button>
      </div>
      {zones.isError ? (
        <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />
      ) : !zones.data ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border bg-surface-raised"
          aria-label="Delivery zones"
        >
          {zones.data.map((z) => (
            <li key={z.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {z.name} {!z.is_active ? <Badge size="sm">Inactive</Badge> : null}
                </p>
                <p className="text-xs text-text-muted">
                  Served by {z.branch_count} branch{z.branch_count === 1 ? '' : 'es'}
                </p>
              </div>
              <IconButton
                label={`Edit zone ${z.name}`}
                size="icon-sm"
                onClick={() => setEditing(z)}
                icon={<Pencil aria-hidden="true" className="size-4" />}
              />
              <IconButton
                label={`Delete zone ${z.name}`}
                size="icon-sm"
                onClick={() => setRemoving(z)}
                icon={<Trash2 aria-hidden="true" className="size-4" />}
              />
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ZoneDialog
          zone={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.name ?? 'zone'}?`}
        description="Zones used by branches or saved customer addresses cannot be deleted; deactivate them instead."
        confirmLabel="Delete zone"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await adminBranchesApi.deleteDeliveryZone(removing.id);
          toast.success(`${removing.name} deleted.`);
          refresh();
        }}
      />
    </section>
  );
}

function ZoneDialog({
  zone,
  onClose,
  onSaved,
}: {
  zone: DeliveryZone | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name ?? '');
  const [active, setActive] = useState(zone?.is_active ?? true);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return setError('Enter a name.');
    setBusy(true);
    setError(undefined);
    try {
      if (zone)
        await adminBranchesApi.updateDeliveryZone(zone.id, {
          name: name.trim(),
          is_active: active,
        });
      else await adminBranchesApi.createDeliveryZone({ name: name.trim(), is_active: active });
      toast.success(zone ? 'Zone saved.' : 'Zone created.');
      onSaved();
      onClose();
    } catch (e) {
      setError(isApiError(e) && e.fields.name ? e.fields.name[0] : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={zone ? `Edit ${zone.name}` : 'New delivery zone'}>
        <div className="grid gap-4">
          <Field label="Name" required error={error}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Switch
            label="Active"
            description="Inactive zones are not offered at checkout."
            checked={active}
            onCheckedChange={setActive}
          />
        </div>
        <DialogFooter className="sticky -bottom-5 -mx-6 mt-5 -mb-5 bg-surface-raised">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {zone ? 'Save zone' : 'Create zone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
