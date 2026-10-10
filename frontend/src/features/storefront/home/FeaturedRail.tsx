import { useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProducts } from '@/lib/api/catalog';
import { usePrefersReducedMotion } from '@/hooks/useMediaQuery';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import {
  Button,
  Container,
  EmptyState,
  ErrorState,
  IconButton,
  Reveal,
  SectionHeading,
} from '@/design';

/** Featured drinks as a snap-scrolling rail (swipe on touch, arrow buttons on desktop). */
export function FeaturedRail() {
  const featured = useProducts({ featured: true, page_size: 10 });
  const railRef = useRef<HTMLUListElement>(null);
  const reduce = usePrefersReducedMotion();
  const items = featured.data?.results ?? [];

  const scrollBy = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section aria-labelledby="featured-title" className="py-20 lg:py-28">
      <Container size="wide">
        <Reveal>
          <SectionHeading
            eyebrow="Fresh from the bar"
            title={<span id="featured-title">Drinks we keep coming back to</span>}
            action={
              <div className="flex items-center gap-2">
                <div className="hidden gap-2 sm:flex">
                  <IconButton
                    variant="secondary"
                    label="Previous drinks"
                    icon={<ChevronLeft aria-hidden="true" className="size-5" />}
                    onClick={() => scrollBy(-1)}
                  />
                  <IconButton
                    variant="secondary"
                    label="Next drinks"
                    icon={<ChevronRight aria-hidden="true" className="size-5" />}
                    onClick={() => scrollBy(1)}
                  />
                </div>
              </div>
            }
          />
        </Reveal>

        <div className="mt-10" aria-busy={featured.isPending || undefined}>
          {featured.isError ? (
            <ErrorState
              error={featured.error}
              onRetry={() => void featured.refetch()}
              retrying={featured.isFetching}
            />
          ) : featured.isPending ? (
            <div className="flex gap-5 overflow-hidden">
              {Array.from({ length: 4 }, (_, i) => (
                <ProductCardSkeleton key={i} className="w-[16.5rem] shrink-0 sm:w-[18.5rem]" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title="The menu is being prepared"
              description="Check back shortly, or have a look at everything we serve."
              action={
                <Button asChild variant="secondary">
                  <Link to="/menu">View the menu</Link>
                </Button>
              }
            />
          ) : (
            <ul
              ref={railRef}
              aria-label="Featured drinks"
              className="-mx-[var(--gutter)] flex snap-x snap-mandatory scroll-px-[var(--gutter)] scrollbar-none gap-5 overflow-x-auto scroll-smooth px-[var(--gutter)] pb-2 motion-reduce:scroll-auto"
            >
              {items.map((p, i) => (
                <li key={p.id} className="w-[16.5rem] shrink-0 snap-start sm:w-[18.5rem]">
                  <ProductCard product={p} priority={i < 2} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-10 flex justify-center">
          <Button asChild variant="link">
            <Link to="/menu">
              View the full menu <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
