import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useMoney } from '@/hooks/useMoney';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useSeo } from '@/hooks/useSeo';
import { useCategories, useCollections } from '@/lib/api/catalog';
import { isApiError } from '@/lib/api/errors';
import {
  Badge,
  Button,
  Container,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  Sheet,
  SheetContent,
  Skeleton,
} from '@/design';
import { useCatalogProducts, useFacets } from './api';
import { ActiveFilters } from './components/ActiveFilters';
import { BranchSelector } from './components/BranchSelector';
import { CatalogBanner } from './components/CatalogBanner';
import { CategoryRail, type RailItem } from './components/CategoryRail';
import { FilterPanel } from './components/FilterPanel';
import { MenuSections } from './components/MenuSections';
import { NoResults } from './components/NoResults';
import { ResultsGrid, ResultsSkeleton } from './components/ResultsGrid';
import {
  CLEARED,
  ORDERING_LABELS,
  PAGE_SIZE,
  activeFilterCount,
  filterChips,
  filtersToSearch,
  hasNarrowing,
  humanize,
  parseFilters,
  toApiParams,
  withFilters,
  type MenuFilters,
  type Ordering,
} from './filters';
import { useSelectedBranch } from './useSelectedBranch';

interface CatalogBrowseProps {
  mode: 'menu' | 'category' | 'search';
  categorySlug?: string;
}

/** Collections that back the flag-only views (`/menu?seasonal=true`) with a name, blurb and picture. */
const FLAG_COLLECTION: Record<string, string> = {
  seasonal: 'seasonal-menu',
  bestseller: 'bestsellers',
  isNew: 'new-arrivals',
};

function SearchHeader({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  const [value, setValue] = useState(query);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(value.trim());
  };
  return (
    <Container size="wide" className="pt-8 pb-4 lg:pt-12">
      <p className="eyebrow mb-3 text-accent-text">Search</p>
      <h1 className="text-h1">{query ? <>Results for “{query}”</> : 'Find your next cup'}</h1>
      <form
        role="search"
        aria-label="Search the menu"
        onSubmit={submit}
        className="mt-6 flex max-w-2xl gap-3"
      >
        <label htmlFor="search-page-input" className="sr-only">
          Search the menu
        </label>
        <Input
          id="search-page-input"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Latte, croissant, Ethiopia…"
          enterKeyHint="search"
          autoComplete="off"
          leading={<Search aria-hidden="true" />}
          className="rounded-pill"
        />
        <Button type="submit">Search</Button>
      </form>
    </Container>
  );
}

export function CatalogBrowse({ mode, categorySlug }: CatalogBrowseProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDesktop = useIsDesktop();
  const { format } = useMoney();
  const { branchSlug, isReady } = useSelectedBranch();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const categories = useCategories();
  const collections = useCollections();

  const searching = mode === 'search';
  const hasQuery = filters.q.length > 0;
  // The overview (/menu with nothing applied) is one sectioned page; every other view is a flat, paged grid.
  const sectioned =
    mode === 'menu' &&
    !hasNarrowing(filters) &&
    !filters.q &&
    !filters.ordering &&
    filters.page === 1;

  const apiParams = toApiParams(filters, { category: categorySlug, branch: branchSlug });
  const listEnabled = isReady && !sectioned && (!searching || hasQuery);
  const list = useCatalogProducts(apiParams, listEnabled);
  const overview = useCatalogProducts(
    { page_size: 100, ordering: 'menu', ...(branchSlug ? { branch: branchSlug } : {}) },
    isReady && sectioned,
  );
  const facets = useFacets(apiParams, isReady && (!searching || hasQuery));

  const category = categorySlug ? categories.data?.find((c) => c.slug === categorySlug) : undefined;
  const categoryMissing = Boolean(categorySlug) && categories.isSuccess && !category;

  const setFilters = (patch: Partial<MenuFilters>) => {
    const next = withFilters(filters, patch);
    navigate(
      { pathname: location.pathname, search: filtersToSearch(next) },
      { preventScrollReset: !('page' in patch) },
    );
  };
  const clearAll = () => setFilters(CLEARED);

  // Scroll the results into view when the page number changes (other filter changes keep the scroll position).
  const lastPage = useRef(filters.page);
  useEffect(() => {
    if (lastPage.current === filters.page) return;
    lastPage.current = filters.page;
    resultsRef.current?.scrollIntoView({ block: 'start' });
  }, [filters.page]);

  // ── SEO ──
  const flagCollection = useMemo(() => {
    if (mode !== 'menu') return undefined;
    const flags = (['seasonal', 'bestseller', 'isNew'] as const).filter((k) => filters[k]);
    if (flags.length !== 1 || filters.type || filters.tag || filters.minPrice || filters.maxPrice)
      return undefined;
    const flag = flags[0] as (typeof flags)[number];
    return collections.data?.find((c) => c.slug === FLAG_COLLECTION[flag]);
  }, [mode, filters, collections.data]);

  const typeLabelFor = (value: string) =>
    facets.data?.types.find((t) => t.value === value)?.label ?? humanize(value.toLowerCase());
  const flagTitle = filters.seasonal
    ? 'Seasonal menu'
    : filters.bestseller
      ? 'Bestsellers'
      : filters.isNew
        ? 'New arrivals'
        : filters.type
          ? typeLabelFor(filters.type)
          : null;
  const pageTitle = searching
    ? hasQuery
      ? `Search results for “${filters.q}”`
      : 'Search'
    : category
      ? category.name
      : (flagCollection?.name ?? flagTitle ?? 'Menu');
  useSeo({
    title: pageTitle,
    description: searching
      ? 'Search drinks, food, beans and merch from Lantern Coffee Roasters.'
      : (category?.description ?? flagCollection?.description),
    image: category?.image ?? flagCollection?.image,
    canonical: categorySlug ? `/menu/${categorySlug}` : searching ? '/search' : '/menu',
    noindex: searching,
  });

  // ── Rail, chips, sort ──
  const railItems: RailItem[] = useMemo(() => {
    const facetCounts = new Map((facets.data?.categories ?? []).map((c) => [c.slug, c.count]));
    return (categories.data ?? [])
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        count: sectioned || !facets.data ? c.product_count : (facetCounts.get(c.slug) ?? 0),
      }))
      .filter((c) => c.count !== 0 || c.slug === categorySlug);
  }, [categories.data, facets.data, sectioned, categorySlug]);

  const chips = filterChips(filters, {
    categoryLabel: (slug) => categories.data?.find((c) => c.slug === slug)?.name ?? humanize(slug),
    typeLabel: typeLabelFor,
    tagLabel: (slug) => humanize(facets.data?.tags.find((t) => t.slug === slug)?.name ?? slug),
    formatPrice: (v) => format(v),
  });
  const filterCount = activeFilterCount(filters);

  const orderingOptions: Ordering[] = hasQuery
    ? ['relevance', 'popularity', 'newest', 'price', '-price', 'name', '-name']
    : ['menu', 'popularity', 'newest', 'price', '-price', 'name', '-name'];
  const defaultOrdering: Ordering = hasQuery ? 'relevance' : 'menu';
  const sortSelect = (
    <div className="flex items-center gap-2">
      <span id="sort-label" className="hidden text-sm text-text-muted sm:inline">
        Sort by
      </span>
      <Select
        aria-label="Sort by"
        className="w-44 sm:w-52"
        value={filters.ordering || defaultOrdering}
        onValueChange={(v) =>
          setFilters({ ordering: v === defaultOrdering ? '' : (v as Ordering) })
        }
        options={orderingOptions.map((o) => ({ value: o, label: ORDERING_LABELS[o] }))}
      />
    </div>
  );

  // ── Render helpers ──
  const total = list.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const searchSuffix = filtersToSearch({
    ...filters,
    page: 1,
    q: mode === 'search' ? filters.q : '',
  });

  if (list.isError && isApiError(list.error) && list.error.status === 404 && filters.page > 1) {
    return (
      <Navigate
        replace
        to={{ pathname: location.pathname, search: filtersToSearch({ ...filters, page: 1 }) }}
      />
    );
  }

  if (categorySlug && categories.isError)
    return (
      <Container className="py-16">
        <ErrorState
          error={categories.error}
          onRetry={() => void categories.refetch()}
          retrying={categories.isFetching}
        />
      </Container>
    );

  if (categoryMissing)
    return (
      <Container className="py-16">
        <EmptyState
          as="h1"
          title="We could not find that category"
          description="It may have been renamed or removed. The full menu has everything we serve."
          action={
            <Button asChild>
              <Link to="/menu">View the menu</Link>
            </Button>
          }
        />
      </Container>
    );

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Menu', to: '/menu' },
    ...(category ? [{ label: category.name }] : flagTitle ? [{ label: flagTitle }] : []),
  ];

  const banner = searching ? (
    <SearchHeader
      key={filters.q}
      query={filters.q}
      onSearch={(q) => setFilters({ q, ordering: '' })}
    />
  ) : categorySlug && !category ? (
    <Container size="wide" className="pt-8 pb-6 lg:pt-12">
      <Skeleton className="h-10 w-1/3" />
    </Container>
  ) : category ? (
    <CatalogBanner
      crumbs={crumbs}
      eyebrow="Menu"
      title={category.name}
      description={category.description}
      image={category.image}
      meta={`${category.product_count} ${category.product_count === 1 ? 'item' : 'items'}`}
    />
  ) : (
    <CatalogBanner
      crumbs={crumbs}
      eyebrow={flagCollection || flagTitle ? 'Collection' : 'Our menu'}
      title={flagCollection?.name ?? flagTitle ?? 'Drinks, bakes & beans'}
      description={
        flagCollection?.description ??
        (flagTitle ? undefined : 'Made to order at the bar, or roasted to take home.')
      }
      image={flagCollection?.image}
    />
  );

  const filterButton = (
    <Button
      ref={filterButtonRef}
      variant="secondary"
      onClick={() => setFiltersOpen(true)}
      aria-haspopup="dialog"
      aria-label={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
      leadingIcon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
      className={sectioned ? '' : 'lg:hidden'}
    >
      Filters
      {filterCount > 0 ? (
        <Badge tone="solid" size="sm" aria-hidden="true">
          {filterCount}
        </Badge>
      ) : null}
    </Button>
  );

  const countText = list.data
    ? `${total} ${total === 1 ? 'item' : 'items'}${hasQuery ? ` for “${filters.q}”` : ''}`
    : '';

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      {filterButton}
      <p
        role="status"
        aria-live="polite"
        className="order-last w-full text-sm text-text-muted empty:hidden sm:order-none sm:w-auto"
      >
        {sectioned ? '' : countText}
      </p>
      <div className="ml-auto">{sortSelect}</div>
    </div>
  );

  const chipRow = (
    <ActiveFilters
      chips={chips}
      onRemove={(chip) => setFilters(chip.clear)}
      onClearAll={clearAll}
    />
  );

  const filterSheet = (
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        onCloseAutoFocus={(e) => {
          if (!filterButtonRef.current) return;
          e.preventDefault();
          filterButtonRef.current.focus();
        }}
        title="Filters"
        description="Narrow the menu by type, dietary needs and price."
      >
        <div className="p-5">
          <FilterPanel
            filters={filters}
            facets={facets.data}
            onChange={setFilters}
            showCategories={searching}
          />
        </div>
        <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-border bg-surface-raised p-4">
          <Button variant="ghost" onClick={clearAll} disabled={filterCount === 0}>
            Clear all
          </Button>
          <Button onClick={() => setFiltersOpen(false)}>
            {!sectioned && list.data ? `Show ${total} ${total === 1 ? 'item' : 'items'}` : 'Done'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );

  const stickyRail = searching ? null : (
    <CategoryRail
      categories={railItems}
      active={categorySlug}
      search={searchSuffix}
      isLoading={categories.isPending}
    />
  );

  const branchBar = (
    <Container size="wide" className="pt-4 lg:hidden">
      <BranchSelector variant="bar" />
    </Container>
  );

  // ── Overview: spotlight band + category sections ──
  if (sectioned) {
    return (
      <>
        {banner}
        {branchBar}
        {stickyRail}
        <Container size="wide" className="py-5">
          {toolbar}
          <div className="mt-3">{chipRow}</div>
        </Container>
        {filterSheet}
        <div aria-busy={overview.isPending || undefined}>
          {overview.isError ? (
            <ErrorState
              error={overview.error}
              onRetry={() => void overview.refetch()}
              retrying={overview.isFetching}
            />
          ) : overview.isPending || !categories.data ? (
            <Container size="wide" className="py-8">
              <ResultsSkeleton count={8} />
            </Container>
          ) : (
            <MenuSections products={overview.data.results} categories={categories.data} />
          )}
        </div>
        <div className="pb-8" />
      </>
    );
  }

  // ── Flat results ──
  const showResults = !searching || hasQuery;
  // Nothing matched and nothing is filtered: no point showing filter controls.
  const bare = Boolean(list.data) && total === 0 && filterCount === 0;
  return (
    <>
      {banner}
      {branchBar}
      {stickyRail}
      <Container size="wide" className="py-6 lg:py-8">
        <div
          className={
            bare || !showResults ? '' : 'lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12'
          }
        >
          {bare || !showResults ? null : (
            <aside
              aria-label="Filters"
              className="hidden lg:sticky lg:top-[calc(var(--header-h)+5.5rem)] lg:block lg:max-h-[calc(100dvh-var(--header-h)-7rem)] lg:self-start lg:overflow-y-auto lg:pr-2"
            >
              <FilterPanel
                filters={filters}
                facets={facets.data}
                onChange={setFilters}
                showCategories={searching}
              />
            </aside>
          )}
          <div ref={resultsRef} className="min-w-0 scroll-mt-[calc(var(--header-h)+5rem)]">
            {showResults && !bare ? (
              <>
                {toolbar}
                <div className="mt-3 empty:hidden">{chipRow}</div>
              </>
            ) : null}
            {filterSheet}
            <div className="mt-6" aria-busy={list.isFetching || undefined}>
              {!showResults ? (
                <NoQuery />
              ) : list.isError ? (
                <ErrorState
                  error={list.error}
                  onRetry={() => void list.refetch()}
                  retrying={list.isFetching}
                />
              ) : list.isPending || !isReady ? (
                <ResultsSkeleton count={PAGE_SIZE / 2} withSidebar />
              ) : list.data.results.length === 0 ? (
                <NoResults
                  query={filters.q}
                  hasFilters={filterCount > 0}
                  onClearFilters={clearAll}
                  onClearSearch={searching ? () => setFilters({ q: '', ...CLEARED }) : undefined}
                />
              ) : (
                <div
                  className={
                    list.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'
                  }
                >
                  <ResultsGrid products={list.data.results} withSidebar />
                  <Pagination
                    className="mt-12"
                    page={filters.page}
                    pageCount={pageCount}
                    onPageChange={(page) => setFilters({ page })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </Container>
    </>
  );
}

/** /search with no query yet: invite a search and offer categories. */
function NoQuery() {
  const categories = useCategories();
  return (
    <div className="mx-auto max-w-2xl py-10 text-center">
      <p className="text-lead text-text-muted">
        Search by name, ingredient, tag or category. Typos are fine, we will find the closest match.
      </p>
      <ul className="mt-8 flex flex-wrap justify-center gap-2.5">
        {(categories.data ?? []).slice(0, 8).map((c) => (
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
    </div>
  );
}
