import { Bike, Clock, Store, CircleCheck, PauseCircle } from 'lucide-react';
import { Badge, RadioCard, RadioGroup, Skeleton } from '@/design';
import type { Branch } from '@/lib/api/types';
import type { OrderType } from '@/lib/api/orders';

export function OrderTypeStep({
  value,
  onChange,
}: {
  value: OrderType;
  onChange: (type: OrderType) => void;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as OrderType)}
      aria-label="Pickup or delivery"
      className="sm:grid-cols-2"
    >
      <RadioCard
        value="PICKUP"
        icon={<Store aria-hidden="true" />}
        title="Pickup"
        description="Collect it at the counter. No delivery fee."
      />
      <RadioCard
        value="DELIVERY"
        icon={<Bike aria-hidden="true" />}
        title="Delivery"
        description="Brought to your door. The fee depends on your area."
      />
    </RadioGroup>
  );
}

/** Why this branch cannot take the current order type, or null if it can. */
export function branchProblem(branch: Branch, orderType: OrderType): string | null {
  if (branch.accepting_orders === false) return 'Not taking online orders right now';
  if (orderType === 'PICKUP' && branch.pickup_enabled === false)
    return 'No pickup at this location';
  if (orderType === 'DELIVERY' && branch.delivery_enabled === false)
    return 'No delivery from this location';
  return null;
}

export function BranchStep({
  branches,
  loading,
  value,
  orderType,
  onChange,
}: {
  branches: Branch[] | undefined;
  loading: boolean;
  value: string | null;
  orderType: OrderType;
  onChange: (slug: string) => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }
  if (!branches || branches.length === 0) {
    return <p className="text-sm text-text-muted">No locations are available right now.</p>;
  }
  return (
    <RadioGroup
      value={value ?? ''}
      onValueChange={onChange}
      aria-label={orderType === 'PICKUP' ? 'Pickup location' : 'Location that prepares your order'}
    >
      {branches.map((branch) => {
        const problem = branchProblem(branch, orderType);
        const open = branch.is_open_now;
        return (
          <RadioCard
            key={branch.id}
            value={branch.slug}
            disabled={Boolean(problem)}
            title={branch.name}
            description={
              <>
                <span className="block">
                  {branch.address_line}, {branch.city}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                  {problem ? (
                    <Badge tone="danger">
                      <PauseCircle aria-hidden="true" /> {problem}
                    </Badge>
                  ) : open ? (
                    <Badge tone="success">
                      <CircleCheck aria-hidden="true" /> Open now
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <Clock aria-hidden="true" /> Closed now · you can schedule for later
                    </Badge>
                  )}
                  {branch.today_hours?.text ? (
                    <span className="text-xs">Today {branch.today_hours.text}</span>
                  ) : null}
                </span>
              </>
            }
          />
        );
      })}
    </RadioGroup>
  );
}
