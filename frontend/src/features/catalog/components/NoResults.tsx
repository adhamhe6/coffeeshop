import { Link } from 'react-router';
import { SearchX } from 'lucide-react';
import { useCategories } from '@/lib/api/catalog';
import { Button, EmptyState } from '@/design';
import { useCatalogProducts } from '../api';
import { useSelectedBranch } from '../useSelectedBranch';
import { ResultsGrid } from './ResultsGrid';

interface NoResultsProps {
  query?: string;
  hasFilters: boolean;
  onClearFilters: () => void;
  onClearSearch?: () => void;
  /** `suggestions` renders only the popular categories/items (under another empty state). */
  variant?: 'full' | 'suggestions';
}

/** Empty result state: says what was searched, offers the way out (clear filters / search) and popular places to go. */
export function NoResults({
  query,
  hasFilters,
  onClearFilters,
  onClearSearch,
  variant = 'full',
}: NoResultsProps) {
  const categories = useCategories();
  const { branchSlug, isReady } = useSelectedBranch();
  const popular = useCatalogProducts(
    { bestseller: true, page_size: 4, ...(branchSlug ? { branch: branchSlug } : {}) },
    isReady,
  );
  const topCategories = [...(categories.data ?? [])]
    .sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0))
    .slice(0, 6);

  return (
    <div data-testid="no-results">
      {variant === 'full' ? (
        <EmptyState
          icon={<SearchX aria-hidden="true" />}
          title={query ? `No results for “${query}”` : 'Nothing matches those filters'}
          description={
            hasFilters
              ? 'Try removing a filter, or browse one of our most popular categories.'
              : 'Check the spelling, try a shorter word, or browse by category.'
          }
          action={
            <>
              {hasFilters ? <Button onClick={onClearFilters}>Clear filters</Button> : null}
              {query && onClearSearch ? (
                <Button variant="secondary" onClick={onClearSearch}>
                  Clear search
                </Button>
              ) : null}
              {!hasFilters && !query ? (
                <Button asChild>
                  <Link to="/menu">Browse the menu</Link>
                </Button>
              ) : null}
            </>
          }
        />
      ) : null}
      {topCategories.length > 0 ? (
        <section aria-labelledby="popular-cats" className="mx-auto mt-4 max-w-2xl text-center">
          <h2 id="popular-cats" className="eyebrow text-text-muted">
            Popular categories
          </h2>
          <ul className="mt-4 flex flex-wrap justify-center gap-2.5">
            {topCategories.map((c) => (
              <li key={c.slug}>
                <Link
                  to={`/menu/${c.slug}`}
                  className="inline-flex h-11 items-center rounded-pill border border-border-strong bg-surface-raised px-4 text-[0.9375rem] font-medium transition-colors hover:border-text"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {popular.data && popular.data.results.length > 0 ? (
        <section aria-labelledby="popular-items" className="mt-14">
          <h2 id="popular-items" className="mb-6 font-display text-h3">
            Popular right now
          </h2>
          <ResultsGrid products={popular.data.results} className="lg:grid-cols-4" />
        </section>
      ) : null}
    </div>
  );
}
