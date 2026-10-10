import { useState } from 'react';
import { Link } from 'react-router';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { Bike, ChevronDown, Clock, MapPin, PauseCircle, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { todayHoursText } from '@/lib/hours';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import type { Branch } from '@/lib/api/types';
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioCard,
  RadioGroup,
  Sheet,
  SheetContent,
  SheetTrigger,
  Skeleton,
  toast,
} from '@/design';
import { branchSupports, useSelectedBranch, type OrderType } from '../useSelectedBranch';

const orderLabel: Record<OrderType, string> = { pickup: 'Pickup', delivery: 'Delivery' };

/** The picker body: fulfilment toggle + one card per branch. Selecting applies immediately. */
export function BranchPicker({ onDone }: { onDone?: () => void }) {
  const { branches, branch, orderType, setBranch, setOrderType, isLoading, isError } =
    useSelectedBranch();

  if (isLoading)
    return (
      <div className="grid gap-3 p-5" aria-busy="true">
        <Skeleton className="h-11" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  if (isError || branches.length === 0)
    return (
      <p className="p-5 text-sm text-text-muted">
        We could not load our locations right now. The menu is still available; availability is
        confirmed when you order.
      </p>
    );

  const deliveryOk = branchSupports(branch, 'delivery');
  return (
    <div className="grid gap-5 p-5">
      <div>
        <p id="fulfilment-label" className="mb-2 text-sm font-medium">
          How would you like it?
        </p>
        <RadioGroupPrimitive.Root
          aria-labelledby="fulfilment-label"
          value={orderType}
          onValueChange={(v) => {
            setOrderType(v as OrderType);
            toast.success(`${orderLabel[v as OrderType]} selected`);
          }}
          orientation="horizontal"
          className="grid grid-cols-2 gap-1 rounded-md border border-border-strong bg-surface-sunken p-1"
        >
          {(
            [
              ['pickup', <ShoppingBag key="p" aria-hidden="true" className="size-4" />],
              ['delivery', <Bike key="d" aria-hidden="true" className="size-4" />],
            ] as const
          ).map(([type, icon]) => {
            const disabled = !branchSupports(branch, type);
            return (
              <RadioGroupPrimitive.Item
                key={type}
                value={type}
                disabled={disabled}
                className={cn(
                  'flex h-10 items-center justify-center gap-2 rounded-sm text-sm font-medium text-text-muted transition-colors',
                  'data-[state=checked]:bg-surface-raised data-[state=checked]:text-text data-[state=checked]:shadow-xs',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {icon} {orderLabel[type]}
              </RadioGroupPrimitive.Item>
            );
          })}
        </RadioGroupPrimitive.Root>
        {!deliveryOk ? (
          <p className="mt-2 text-sm text-text-muted">
            {branch?.name} offers pickup only. Choose another branch for delivery.
          </p>
        ) : null}
      </div>

      <div>
        <p id="branch-label" className="mb-2 text-sm font-medium">
          Branch
        </p>
        <RadioGroup
          aria-labelledby="branch-label"
          value={branch?.slug ?? ''}
          onValueChange={(slug) => {
            setBranch(slug);
            const picked = branches.find((b) => b.slug === slug);
            if (picked) toast.success(`Ordering from ${picked.name}`);
          }}
          className="gap-2.5"
        >
          {branches.map((b) => (
            <BranchCard key={b.id} branch={b} />
          ))}
        </RadioGroup>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="link">
          <Link to="/locations" onClick={onDone}>
            Locations &amp; hours
          </Link>
        </Button>
        {onDone ? (
          <Button onClick={onDone} size="sm">
            Done
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function BranchCard({ branch }: { branch: Branch }) {
  const paused = branch.accepting_orders === false;
  return (
    <RadioCard
      value={branch.slug}
      title={branch.name}
      className="p-3.5"
      description={
        <span className="grid gap-1.5">
          <span>
            {branch.address_line}, {branch.city}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {paused ? (
              <Badge tone="warning" size="sm">
                <PauseCircle aria-hidden="true" /> Orders paused
              </Badge>
            ) : branch.is_open_now !== undefined ? (
              <Badge tone={branch.is_open_now ? 'success' : 'neutral'} size="sm">
                <Clock aria-hidden="true" /> {branch.is_open_now ? 'Open now' : 'Closed'}
              </Badge>
            ) : null}
            <span className="text-xs">{todayHoursText(branch)}</span>
          </span>
          <span className="flex gap-1.5">
            {branch.pickup_enabled ? (
              <Badge tone="outline" size="sm">
                <ShoppingBag aria-hidden="true" /> Pickup
              </Badge>
            ) : null}
            {branch.delivery_enabled ? (
              <Badge tone="outline" size="sm">
                <Bike aria-hidden="true" /> Delivery
              </Badge>
            ) : null}
          </span>
        </span>
      }
    />
  );
}

interface BranchSelectorProps {
  /** `header`: compact pill for the site header. `bar`: full-width "Ordering from …" strip for page tops. */
  variant?: 'header' | 'bar';
  className?: string;
}

/**
 * Branch + pickup/delivery control. A popover on desktop, a bottom sheet on phones.
 * Reads/writes through `useSelectedBranch()`.
 */
export function BranchSelector({ variant = 'header', className }: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const { branch, orderType, isLoading, branches } = useSelectedBranch();

  if (isLoading) return <Skeleton className={cn('h-10 w-44', className)} />;
  if (!branch || branches.length === 0) return null;

  const label = `${branch.name}, ${orderLabel[orderType].toLowerCase()}`;
  const trigger =
    variant === 'header' ? (
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-10 max-w-72 gap-1.5 px-2.5 font-medium', className)}
        aria-label={`Ordering ${label}. Change branch`}
        aria-haspopup="dialog"
      >
        <MapPin aria-hidden="true" className="size-4 text-accent-text" />
        <span className="hidden truncate xl:inline">{branch.name}</span>
        <span className="text-text-muted xl:before:content-['·_']">{orderLabel[orderType]}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 text-text-muted" />
      </Button>
    ) : (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Ordering ${label}. Change branch`}
        className={cn(
          'group flex min-h-12 w-full items-center gap-3 rounded-md border border-border bg-surface-raised px-3.5 py-2 text-left transition-colors hover:border-border-strong',
          className,
        )}
      >
        <MapPin aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="text-text-muted">{orderLabel[orderType]} from </span>
          <span className="font-medium">{branch.name}</span>
          <span className="block truncate text-xs text-text-muted">
            {branch.accepting_orders === false
              ? 'Orders paused right now'
              : `${branch.is_open_now ? 'Open now' : 'Closed'} · ${todayHoursText(branch)}`}
          </span>
        </span>
        <span className="text-sm font-medium text-accent-text underline underline-offset-4">
          Change
        </span>
      </button>
    );

  if (isDesktop)
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-[24rem] max-w-[calc(100vw-2rem)] p-0">
          <BranchPicker onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        title="Where are you ordering from?"
        description="Choose a branch and whether you will pick up or have it delivered."
      >
        <BranchPicker onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
