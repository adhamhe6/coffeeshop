import { Link } from 'react-router';
import { ArrowRight, Bike, Clock, MapPin, ShoppingBag } from 'lucide-react';
import { useBranches } from '@/lib/api/branches';
import { todayHoursText } from '@/lib/hours';
import {
  Badge,
  Button,
  Container,
  ErrorState,
  ProductImage,
  Reveal,
  SectionHeading,
  Skeleton,
} from '@/design';

export function LocationsPreview() {
  const branches = useBranches();
  const items = (branches.data ?? []).slice(0, 3);
  if (branches.isSuccess && items.length === 0) return null;

  return (
    <section aria-labelledby="locations-title" className="bg-surface-sunken/55 py-20 lg:py-28">
      <Container size="wide">
        <Reveal>
          <SectionHeading
            eyebrow="Visit us"
            title={<span id="locations-title">Find your Lantern</span>}
            description="Pull up a stool, or order ahead and we will have it waiting."
            action={
              <Button asChild variant="link">
                <Link to="/locations">
                  All locations &amp; hours <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
            }
          />
        </Reveal>
        <div className="mt-10" aria-busy={branches.isPending || undefined}>
          {branches.isError ? (
            <ErrorState
              error={branches.error}
              onRetry={() => void branches.refetch()}
              retrying={branches.isFetching}
            />
          ) : branches.isPending ? (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-80 rounded-lg" />
              ))}
            </div>
          ) : (
            <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {items.map((b, i) => (
                <li key={b.id}>
                  <Reveal delay={i * 80} className="h-full">
                    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised">
                      <ProductImage
                        src={b.image}
                        alt=""
                        aspect="16/10"
                        square
                        sizes="(min-width: 1024px) 30vw, 90vw"
                      />
                      <div className="flex flex-1 flex-col gap-3 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-display text-[1.3125rem] leading-snug font-medium">
                            {b.name}
                          </h3>
                          {b.is_open_now !== undefined ? (
                            <Badge tone={b.is_open_now ? 'success' : 'neutral'}>
                              <Clock aria-hidden="true" /> {b.is_open_now ? 'Open now' : 'Closed'}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="flex items-start gap-2 text-sm text-text-muted">
                          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                          <span>
                            {b.address_line}, {b.city}
                            {b.is_placeholder_address ? (
                              <span className="ml-2 text-xs italic">(sample address)</span>
                            ) : null}
                          </span>
                        </p>
                        <p className="flex items-center gap-2 text-sm text-text-muted">
                          <Clock aria-hidden="true" className="size-4 shrink-0" />
                          Today {todayHoursText(b)}
                        </p>
                        <ul className="mt-auto flex flex-wrap gap-2 pt-1">
                          {b.pickup_enabled ? (
                            <li>
                              <Badge tone="outline">
                                <ShoppingBag aria-hidden="true" /> Pickup
                              </Badge>
                            </li>
                          ) : null}
                          {b.delivery_enabled ? (
                            <li>
                              <Badge tone="outline">
                                <Bike aria-hidden="true" /> Delivery
                              </Badge>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                    </article>
                  </Reveal>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Container>
    </section>
  );
}
