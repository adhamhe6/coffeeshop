import { Link } from 'react-router';
import { ArrowRight, Leaf } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Category, ProductSummary } from '@/lib/api/types';
import { Button, Container } from '@/design';
import { ProductCard } from './ProductCard';

interface MenuSectionsProps {
  products: ProductSummary[];
  categories: Category[];
  /** How many cards each category section shows before "See all". */
  perSection?: number;
}

interface Section {
  slug: string;
  name: string;
  items: ProductSummary[];
}

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-4 lg:gap-x-6';

/** Group the (menu-ordered) product list by category, keeping the order the API returned. */
export function groupByCategory(products: ProductSummary[]): Section[] {
  const sections: Section[] = [];
  for (const p of products) {
    const slug = p.category?.slug ?? 'other';
    let section = sections.find((s) => s.slug === slug);
    if (!section) {
      section = { slug, name: p.category?.name ?? 'More', items: [] };
      sections.push(section);
    }
    section.items.push(p);
  }
  return sections;
}

/**
 * The "all menu" view: a seasonal spotlight band, then one section per category (first few items, "See all" link),
 * with alternating backgrounds so the page has rhythm instead of one endless grid.
 */
export function MenuSections({ products, categories, perSection = 4 }: MenuSectionsProps) {
  const seasonal = products
    .filter((p) => p.flags?.is_seasonal && p.is_available !== false)
    .slice(0, 4);
  const seasonalIds = new Set(seasonal.map((p) => p.id));
  // A category whose every item is already in the spotlight band would only repeat it.
  const sections = groupByCategory(products).filter(
    (s) => !s.items.every((p) => seasonalIds.has(p.id)),
  );
  const byslug = new Map(categories.map((c) => [c.slug, c]));

  return (
    <>
      {seasonal.length > 0 ? (
        <section
          aria-labelledby="menu-seasonal"
          data-surface="dark"
          className="bg-surface-inverse py-14 text-text-inverse lg:py-20"
        >
          <Container size="wide">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="max-w-2xl">
                <p className="eyebrow mb-3 inline-flex items-center gap-2 text-accent-on-dark">
                  <Leaf aria-hidden="true" className="size-3.5" /> In season
                </p>
                <h2 id="menu-seasonal" className="text-h2 text-text-inverse">
                  Autumn, in the cup
                </h2>
                <p className="mt-3 text-lead text-text-inverse-muted">
                  Limited-run drinks and bakes while the weather turns.
                </p>
              </div>
              <Button asChild variant="inverse" size="sm">
                <Link to="/menu?seasonal=true">
                  All seasonal <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
            </div>
            <ul className={cn(GRID, 'mt-10')}>
              {seasonal.map((p) => (
                <li key={p.id}>
                  <ProductCard product={p} tone="inverse" aspect="1/1" showAdd />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}

      {sections.map((section, i) => {
        const category = byslug.get(section.slug);
        const total = category?.product_count ?? section.items.length;
        const id = `menu-section-${section.slug}`;
        return (
          <section
            key={section.slug}
            aria-labelledby={id}
            className={cn('py-12 lg:py-16', i % 2 === 1 && 'bg-surface-sunken/45')}
          >
            <Container size="wide">
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div className="max-w-xl">
                  <h2 id={id} className="text-h2">
                    {section.name}
                  </h2>
                  {category?.description ? (
                    <p className="mt-2 text-text-muted">{category.description}</p>
                  ) : null}
                </div>
                <Button asChild variant="link">
                  <Link to={`/menu/${section.slug}`}>
                    See all {total} <span className="sr-only">in {section.name}</span>
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </Button>
              </div>
              <ul className={cn(GRID, 'mt-8')}>
                {section.items.slice(0, perSection).map((p) => (
                  <li key={p.id}>
                    <ProductCard product={p} aspect="1/1" showAdd />
                  </li>
                ))}
              </ul>
            </Container>
          </section>
        );
      })}
    </>
  );
}
