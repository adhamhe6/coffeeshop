import { useState } from 'react';
import { CirclePause, CirclePlay } from 'lucide-react';
import { Badge, Button, Switch } from '@/design';
import type { AdminBranch } from '@/lib/api/adminBranches';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { useBranchSwitch } from '../useBranchPatch';

export function OrderControls({ branch, canManage }: { branch: AdminBranch; canManage: boolean }) {
  const change = useBranchSwitch(branch);
  const [confirmPause, setConfirmPause] = useState(false);

  return (
    <section
      aria-labelledby="order-controls-title"
      className="grid gap-4 rounded-lg border border-border bg-surface-raised p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 id="order-controls-title" className="font-display text-h4 font-semibold">
            Order controls
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {branch.accepting_orders ? (
              <Badge tone="success">Taking orders</Badge>
            ) : (
              <Badge tone="warning">Orders paused</Badge>
            )}
            <Badge tone={branch.is_open_now ? 'success' : 'neutral'}>
              {branch.is_open_now ? 'Open now' : 'Closed now'}
            </Badge>
          </p>
        </div>
        {canManage ? (
          branch.accepting_orders ? (
            <Button
              variant="danger"
              leadingIcon={<CirclePause aria-hidden="true" className="size-4" />}
              onClick={() => setConfirmPause(true)}
            >
              Pause orders
            </Button>
          ) : (
            <Button
              leadingIcon={<CirclePlay aria-hidden="true" className="size-4" />}
              loading={change.isPending && change.variables?.field === 'accepting_orders'}
              onClick={() => change.mutate({ field: 'accepting_orders', value: true })}
            >
              Resume orders
            </Button>
          )
        ) : null}
      </div>
      {!branch.accepting_orders ? (
        <p role="status" className="rounded-md bg-warning-bg p-3 text-sm font-medium text-warning">
          Customers cannot place new orders at {branch.name} until you resume. Orders already placed
          are not affected.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Switch
          label="Pickup"
          description="Customers can order for pickup at this branch."
          checked={branch.pickup_enabled}
          disabled={!canManage}
          onCheckedChange={(v) => change.mutate({ field: 'pickup_enabled', value: v })}
        />
        <Switch
          label="Delivery"
          description="Customers in linked delivery zones can order delivery."
          checked={branch.delivery_enabled}
          disabled={!canManage}
          onCheckedChange={(v) => change.mutate({ field: 'delivery_enabled', value: v })}
        />
      </div>
      <p className="text-sm text-text-muted">
        These switches take effect immediately: the checkout and the location pages on the
        storefront stop offering what is off.
      </p>
      <ConfirmDialog
        open={confirmPause}
        onOpenChange={setConfirmPause}
        title={`Pause orders at ${branch.name}?`}
        description="Customers will not be able to place new pickup or delivery orders from this branch until you resume. Orders already placed continue as normal."
        confirmLabel="Pause orders"
        destructive
        onConfirm={async () => {
          await change.mutateAsync({ field: 'accepting_orders', value: false });
        }}
      />
    </section>
  );
}
