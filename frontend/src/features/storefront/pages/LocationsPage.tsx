import { Link, useNavigate } from 'react-router';
import { Bike, Clock, Mail, MapPin, PauseCircle, Phone, ShoppingBag } from 'lucide-react';
import { useSeo } from '@/hooks/useSeo';
import { cn } from '@/lib/cn';
import { useBranches } from '@/lib/api/branches';
import { todayHoursText } from '@/lib/hours';
import type { Branch } from '@/lib/api/types';
import {
  Badge,
  Button,
  Container,
  EmptyState,
  ErrorState,
  Money,
  ProductImage,
  SectionHeading,
  Skeleton,
  toast,
} from '@/design';
import { nextOpenText, todayWeekday } from '@/features/catalog/branchHours';
import { useSelectedBranch, branchSupports } from '@/features/catalog/useSelectedBranch';

function OpenBadge({ branch }: { branch: Branch }) {
  if (branch.accepting_orders === false)
    return (
      <Badge tone="warning">
        <PauseCircle aria-hidden="true" /> Orders paused
      </Badge>
    );
  return (
    <Badge tone={branch.is_open_now ? 'success' : 'neutral'}>
      <Clock aria-hidden="true" /> {branch.is_open_now ? 'Open now' : 'Closed now'}
    </Badge>
  );
}

function WeeklyHours({ branch }: { branch: Branch }) {
  const today = todayWeekday(branch.timezone);
  const hours = [...(branch.hours ?? [])].sort((a, b) => a.weekday - b.weekday);
  if (hours.length === 0) return null;
  return (
    <dl className="grid gap-1 text-sm">
      {hours.map((h) => (
        <div
          key={h.weekday}
          aria-current={h.weekday === today ? 'date' : undefined}
          className={cn(
            'flex justify-between gap-4 rounded-sm px-2 py-1',
            h.weekday === today && 'bg-accent-soft font-medium',
          )}
        >
          <dt>
            {h.label ?? `Day ${h.weekday}`}
            {h.weekday === today ? (
              <span className="ml-1.5 text-xs text-accent-text">Today</span>
            ) : null}
          </dt>
          <dd className="tabular-nums">{h.is_closed ? 'Closed' : (h.text ?? '')}</dd>
        </div>
      ))}
    </dl>
  );
}

function Zones({ branch }: { branch: Branch }) {
  const zones = branch.delivery_zones ?? [];
  if (!branch.delivery_enabled || zones.length === 0) return null;
  return (
    <section aria-label={`Delivery zones for ${branch.name}`}>
      <h3 className="mb-2 text-sm font-semibold">Delivery zones &amp; fees</h3>
      <ul className="grid gap-1.5 text-sm">
        {zones.map((z) => (
          <li key={z.zone_id} className="grid">
            <span className="font-medium">{z.name}</span>
            <span className="text-text-muted">
              {z.fee !== undefined ? (
                <>
                  <Money value={z.fee} /> fee
                </>
              ) : null}
              {z.min_order_total && Number(z.min_order_total) > 0 ? (
                <>
                  {' · min '}
                  <Money value={z.min_order_total} />
                </>
              ) : null}
              {z.free_delivery_over ? (
                <>
                  {' · free over '}
                  <Money value={z.free_delivery_over} />
                </>
              ) : null}
              {z.eta_minutes ? ` · about ${z.eta_minutes} min` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BranchCard({ branch, selected }: { branch: Branch; selected: boolean }) {
  const { setBranch, setOrderType } = useSelectedBranch();
  const navigate = useNavigate();
  const paused = branch.accepting_orders === false;
  const nextOpen = !branch.is_open_now ? nextOpenText(branch) : null;

  const orderHere = (type: 'pickup' | 'delivery') => {
    setBranch(branch.slug);
    setOrderType(type);
    toast.success(`Ordering ${type} from ${branch.name}`);
    navigate('/menu');
  };

  return (
    <article
      aria-labelledby={`branch-${branch.slug}`}
      className="overflow-hidden rounded-lg border border-border bg-surface-raised"
    >
      <ProductImage
        src={branch.image}
        alt=""
        aspect="auto"
        square
        sizes="(min-width: 1280px) 1280px, 100vw"
        className="h-44 sm:h-56 lg:h-64"
      />
      <div className="grid gap-6 p-5 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id={`branch-${branch.slug}`} className="font-display text-h3 font-medium">
              {branch.name}
            </h2>
            {branch.description ? (
              <p className="mt-1 text-text-muted">{branch.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {selected ? <Badge tone="accent">Your branch</Badge> : null}
            <OpenBadge branch={branch} />
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="grid content-start gap-4">
            <div className="grid gap-2 text-[0.9375rem]">
              <p className="flex items-start gap-2.5">
                <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <span>
                  {branch.address_line}, {branch.city}
                  {branch.postal_code ? ` ${branch.postal_code}` : ''}
                  {branch.is_placeholder_address ? (
                    <span className="ml-2 text-xs text-text-muted italic">(sample address)</span>
                  ) : null}
                </span>
              </p>
              {branch.phone ? (
                <p className="flex items-center gap-2.5">
                  <Phone aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                  <a
                    href={`tel:${branch.phone.replace(/[^+\d]/g, '')}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {branch.phone}
                  </a>
                </p>
              ) : null}
              {branch.email ? (
                <p className="flex items-center gap-2.5">
                  <Mail aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                  <a href={`mailto:${branch.email}`} className="underline-offset-4 hover:underline">
                    {branch.email}
                  </a>
                </p>
              ) : null}
              <p className="flex items-center gap-2.5">
                <Clock aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                <span>
                  Today {todayHoursText(branch)}
                  {nextOpen ? <span className="text-text-muted"> · {nextOpen}</span> : null}
                </span>
              </p>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Ways to order">
              {branch.pickup_enabled ? (
                <li>
                  <Badge tone="outline">
                    <ShoppingBag aria-hidden="true" /> Pickup
                    {branch.prep_minutes ? ` · ~${branch.prep_minutes} min` : ''}
                  </Badge>
                </li>
              ) : null}
              {branch.delivery_enabled ? (
                <li>
                  <Badge tone="outline">
                    <Bike aria-hidden="true" /> Delivery
                  </Badge>
                </li>
              ) : (
                <li>
                  <Badge tone="neutral">No delivery</Badge>
                </li>
              )}
            </ul>
          </div>
          <section aria-label={`Opening hours for ${branch.name}`}>
            <h3 className="mb-2 text-sm font-semibold">Opening hours</h3>
            <WeeklyHours branch={branch} />
          </section>
          <Zones branch={branch} />
        </div>

        <div className="flex flex-wrap gap-3 border-t border-border pt-5">
          {branchSupports(branch, 'pickup') ? (
            <Button
              onClick={() => orderHere('pickup')}
              disabled={paused}
              leadingIcon={<ShoppingBag aria-hidden="true" className="size-4" />}
              aria-label={`Order pickup here at ${branch.name}`}
            >
              Order pickup here
            </Button>
          ) : null}
          {branch.delivery_enabled ? (
            <Button
              variant="secondary"
              onClick={() => orderHere('delivery')}
              disabled={paused}
              leadingIcon={<Bike aria-hidden="true" className="size-4" />}
              aria-label={`Order delivery from ${branch.name}`}
            >
              Order delivery
            </Button>
          ) : null}
          {paused ? (
            <p className="self-center text-sm text-text-muted">
              Online orders are paused at the moment. Walk-ins are welcome during opening hours.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function LocationsPage() {
  useSeo({
    title: 'Locations & opening hours',
    description:
      'Find a Lantern Coffee Roasters branch: opening hours, pickup and delivery options, delivery zones and fees.',
  });
  const branches = useBranches();
  const { branch: selected } = useSelectedBranch();

  return (
    <Container size="wide" className="py-12 lg:py-16">
      <SectionHeading
        as="h1"
        eyebrow="Visit us"
        title="Locations & hours"
        description="Pull up a stool, or order ahead and pick it up. Choose a branch to start an order."
      />
      <div className="mt-10 grid gap-8" aria-busy={branches.isPending || undefined}>
        {branches.isPending ? (
          [0, 1].map((i) => <Skeleton key={i} className="h-96 rounded-lg" />)
        ) : branches.isError ? (
          <ErrorState
            error={branches.error}
            onRetry={() => void branches.refetch()}
            retrying={branches.isFetching}
          />
        ) : (branches.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No locations to show yet"
            description="Check back soon, or send us a message."
            action={
              <Button asChild>
                <Link to="/contact">Contact us</Link>
              </Button>
            }
          />
        ) : (
          branches.data?.map((b) => (
            <BranchCard key={b.id} branch={b} selected={selected?.slug === b.slug} />
          ))
        )}
      </div>
    </Container>
  );
}
