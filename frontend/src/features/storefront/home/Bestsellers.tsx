import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useProducts } from '@/lib/api/catalog';
import { ProductCard, ProductCardSkeleton } from '@/features/catalog/components/ProductCard';
import { Button, Container, ErrorState, Reveal, SectionHeading } from '@/design';

export function Bestsellers() {
  const query = useProducts({ bestseller: true, page_size: 4 });
  const items = query.data?.results ?? [];
  if (query.isSuccess && items.length === 0) return null;

  return (
    <section aria-labelledby="bestsellers-title" className="py-20 lg:py-28">
      <Container size="wide">
        <Reveal>
          <SectionHeading
            eyebrow="Most loved"
            title={<span id="bestsellers-title">The ones everyone orders</span>}
            action={
              <Button asChild variant="link">
                <Link to="/menu?bestseller=true">
                  Shop bestsellers <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
            }
          />
        </Reveal>
        <div className="mt-10" aria-busy={query.isPending || undefined}>
          {query.isError ? (
            <ErrorState
              error={query.error}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          ) : query.isPending ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4 lg:gap-x-6">
              {Array.from({ length: 4 }, (_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4 lg:gap-x-6">
              {items.map((p, i) => (
                <li key={p.id}>
                  <Reveal delay={i * 70}>
                    <ProductCard product={p} rank={i + 1} sizes="(min-width: 1024px) 22vw, 46vw" />
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
