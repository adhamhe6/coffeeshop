import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useProducts } from '@/lib/api/catalog';
import type { ProductSummary, ProductType } from '@/lib/api/types';
import { Button, Container, Money, ProductImage, Reveal } from '@/design';

function MiniProducts({ items, tone }: { items: ProductSummary[]; tone: 'light' | 'dark' }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-8 grid grid-cols-3 gap-3 sm:gap-4">
      {items.map((p) => (
        <li key={p.id} className="relative">
          <ProductImage src={p.image} alt="" aspect="1/1" sizes="14vw" />
          <p className="mt-2 line-clamp-1 text-sm font-medium">
            <Link
              to={`/p/${p.slug}`}
              className="rounded-xs after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
            >
              {p.name}
            </Link>
          </p>
          <Money
            value={p.base_price}
            className={tone === 'dark' ? 'text-sm text-cream' : 'text-sm text-text-muted'}
          />
        </li>
      ))}
    </ul>
  );
}

function useType(type: ProductType, size: number) {
  return useProducts({ type, page_size: size }).data?.results ?? [];
}

/** Two big spotlight tiles: whole-bean coffee and merchandise. Copy is static; products come from the API. */
export function BeansMerch() {
  const beans = useType('BEANS', 3);
  const merch = useType('MERCH', 3);
  return (
    <section aria-labelledby="beans-title" className="py-20 lg:py-28">
      <Container size="wide" className="grid gap-5 lg:grid-cols-12 lg:gap-6">
        <Reveal className="rounded-lg bg-surface-sunken p-7 sm:p-10 lg:col-span-7 lg:p-14">
          <p className="eyebrow text-accent-text">Whole bean</p>
          <h2 id="beans-title" className="mt-4 max-w-md text-h2">
            Take the roast home with you
          </h2>
          <p className="mt-4 max-w-md text-[1.0625rem] text-text-muted">
            Freshly roasted, ground to order or left whole. Pick a bag from our current lots and
            brew it your way.
          </p>
          <Button
            asChild
            className="mt-7"
            trailingIcon={<ArrowRight aria-hidden="true" className="size-4" />}
          >
            <Link to="/menu?type=BEANS">Shop beans</Link>
          </Button>
          <MiniProducts items={beans} tone="light" />
        </Reveal>

        <Reveal
          delay={100}
          className="rounded-lg bg-sage p-7 text-cream sm:p-10 lg:col-span-5 lg:p-12"
          data-surface="dark"
        >
          <p className="eyebrow text-cream">Gear &amp; merch</p>
          <h2 className="mt-4 text-h2 text-white">Tools we actually use</h2>
          <p className="mt-4 max-w-sm text-[1.0625rem] text-cream">
            Mugs from our own bar, plus the filters and brewers we reach for every morning.
          </p>
          <Button
            asChild
            variant="inverse"
            className="mt-7"
            trailingIcon={<ArrowRight aria-hidden="true" className="size-4" />}
          >
            <Link to="/menu?type=MERCH">Shop merch</Link>
          </Button>
          <MiniProducts items={merch.slice(0, 3)} tone="dark" />
        </Reveal>
      </Container>
    </section>
  );
}
