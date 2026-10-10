import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCategories } from '@/lib/api/catalog';
import type { Category } from '@/lib/api/types';
import {
  Container,
  ErrorState,
  LogoGlyph,
  ProductImage,
  Reveal,
  SectionHeading,
  Skeleton,
} from '@/design';

const FALLBACK_TONES = [
  'bg-surface-inverse text-cream',
  'bg-sage text-cream',
  'bg-accent text-white',
  'bg-surface-sunken text-text',
];

/** Grid placement for a 4-tile editorial mosaic at ≥ lg: tall / wide / tall / wide, 5-4-3 columns. */
const MOSAIC = [
  'col-span-2 aspect-[16/10] lg:col-span-5 lg:row-span-2 lg:aspect-auto',
  'aspect-square lg:col-span-4 lg:aspect-auto',
  'aspect-square lg:col-span-3 lg:row-span-2 lg:aspect-auto',
  'col-span-2 aspect-[16/9] lg:col-span-4 lg:aspect-auto',
];

function Tile({
  category,
  className,
  index,
  priority,
}: {
  category: Category;
  className?: string;
  index: number;
  priority?: boolean;
}) {
  const fallback = FALLBACK_TONES[index % FALLBACK_TONES.length];
  const tall = index === 0 || index === 2;
  return (
    <Link
      to={`/menu/${category.slug}`}
      className={cn(
        'group relative isolate flex overflow-hidden rounded-lg',
        !category.image && fallback,
        className,
      )}
    >
      {category.image ? (
        <ProductImage
          src={category.image}
          alt=""
          aspect="auto"
          priority={priority}
          square
          sizes="(min-width: 1024px) 40vw, 100vw"
          className="absolute inset-0 -z-10"
          imgClassName="transition-transform duration-700 ease-[var(--ease-emphasized)] group-hover:scale-105 motion-reduce:transition-none"
        />
      ) : (
        <LogoGlyph
          variant="mono"
          className="absolute -right-6 -bottom-6 -z-10 h-2/3 w-auto opacity-10"
        />
      )}
      {category.image ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgb(43_29_22/0.84)_0%,rgb(43_29_22/0.4)_30%,transparent_58%)]"
        />
      ) : null}
      <div
        className={cn(
          'mt-auto flex w-full items-end justify-between gap-3 p-5 sm:p-6',
          category.image && 'text-cream',
        )}
      >
        <div className="min-w-0">
          <h3
            className={cn(
              'font-display font-medium text-balance',
              tall ? 'text-h3' : 'text-[1.375rem]',
            )}
          >
            {category.name}
          </h3>
          {category.description && (tall || !category.image) ? (
            <p
              className={cn(
                'mt-1.5 line-clamp-2 max-w-xs text-sm',
                category.image ? 'text-cream' : 'opacity-90',
              )}
            >
              {category.description}
            </p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-current/40 transition-colors group-hover:bg-cream group-hover:text-espresso"
        >
          <ArrowUpRight className="size-4" />
        </span>
      </div>
    </Link>
  );
}

/** Asymmetric category grid built from `categories/` — featured categories first. */
export function CategoryMosaic() {
  const categories = useCategories();
  const all = [...(categories.data ?? [])].sort(
    (a, b) =>
      Number(b.is_featured) - Number(a.is_featured) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  const tiles = all.slice(0, 4);
  const rest = all.slice(4);

  return (
    <section aria-labelledby="categories-title" className="bg-surface-sunken/55 py-20 lg:py-28">
      <Container size="wide">
        <Reveal>
          <SectionHeading
            eyebrow="Explore"
            title={<span id="categories-title">Find your corner of the menu</span>}
            description="From the espresso bar to bags of beans for the shelf at home."
          />
        </Reveal>

        <div className="mt-10" aria-busy={categories.isPending || undefined}>
          {categories.isError ? (
            <ErrorState
              error={categories.error}
              onRetry={() => void categories.refetch()}
              retrying={categories.isFetching}
            />
          ) : categories.isPending ? (
            <div className="grid grid-cols-2 gap-3 lg:h-[40rem] lg:grid-cols-12 lg:grid-rows-2 lg:gap-4">
              {MOSAIC.map((cls, i) => (
                <Skeleton key={i} className={cn('rounded-lg', cls)} />
              ))}
            </div>
          ) : tiles.length === 0 ? null : (
            <Reveal>
              {tiles.length === 4 ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:h-[42rem] lg:grid-cols-12 lg:grid-rows-2">
                  {tiles.map((c, i) => (
                    <Tile key={c.id} category={c} index={i} className={MOSAIC[i]} />
                  ))}
                </div>
              ) : (
                <div
                  className={cn(
                    'grid gap-3 sm:gap-4',
                    tiles.length === 1
                      ? ''
                      : tiles.length === 2
                        ? 'sm:grid-cols-2'
                        : 'sm:grid-cols-3',
                  )}
                >
                  {tiles.map((c, i) => (
                    <Tile
                      key={c.id}
                      category={c}
                      index={i}
                      className="aspect-[4/3] sm:aspect-[4/5]"
                    />
                  ))}
                </div>
              )}
              {rest.length > 0 ? (
                <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
                  Also on the menu:
                  {rest.map((c) => (
                    <Link
                      key={c.id}
                      to={`/menu/${c.slug}`}
                      className="rounded-xs font-medium text-text underline underline-offset-4 hover:text-accent-text"
                    >
                      {c.name}
                    </Link>
                  ))}
                </p>
              ) : null}
            </Reveal>
          )}
        </div>
      </Container>
    </section>
  );
}
