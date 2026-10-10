import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useProducts } from '@/lib/api/catalog';
import type { ContentBlock } from '@/lib/api/types';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import { Button, Container, Reveal, SmartLink } from '@/design';

/** Full-bleed espresso band for the seasonal menu. Hidden when there is nothing seasonal on sale. */
export function SeasonalBand({ block }: { block?: ContentBlock }) {
  const query = useProducts({ seasonal: true, page_size: 3 });
  const items = query.data?.results ?? [];
  if (query.isSuccess && items.length === 0) return null;
  if (query.isError) return null;

  return (
    <section
      data-surface="dark"
      aria-labelledby="seasonal-title"
      className="overflow-hidden bg-surface-inverse py-20 text-text-inverse lg:py-28"
    >
      <Container size="wide" className="grid gap-12 lg:grid-cols-12 lg:items-center">
        <Reveal className="lg:col-span-4">
          <p className="eyebrow text-accent-on-dark">{block?.eyebrow || 'Seasonal'}</p>
          <h2 id="seasonal-title" className="mt-4 text-h1 text-text-inverse">
            {block?.title || 'The season, in a cup'}
          </h2>
          <p className="mt-5 text-lead text-text-inverse-muted">
            {block?.body ||
              'Limited-run drinks built around what is good right now. When the season turns, they are gone.'}
          </p>
          <Button
            asChild
            variant="inverse"
            size="lg"
            className="mt-8"
            trailingIcon={<ArrowRight aria-hidden="true" className="size-4" />}
          >
            {block?.cta_url ? (
              <SmartLink to={block.cta_url}>
                {block.cta_label || 'Explore the seasonal menu'}
              </SmartLink>
            ) : (
              <Link to="/menu?seasonal=true">Explore the seasonal menu</Link>
            )}
          </Button>
        </Reveal>

        <div className="lg:col-span-8" aria-busy={query.isPending || undefined}>
          {query.isPending ? (
            <div className="grid gap-5 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <ul className="-mx-[var(--gutter)] flex snap-x snap-mandatory scroll-px-[var(--gutter)] scrollbar-none gap-4 overflow-x-auto px-[var(--gutter)] pb-2 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0">
              {items.map((p, i) => (
                <li
                  key={p.id}
                  className={cn(
                    'w-[72%] shrink-0 snap-start sm:w-auto',
                    i === 1 && 'sm:mt-12',
                    i === 2 && 'sm:mt-4',
                  )}
                >
                  <Reveal delay={i * 90}>
                    <ProductCard
                      product={p}
                      tone="inverse"
                      sizes="(min-width: 1024px) 24vw, 80vw"
                    />
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
