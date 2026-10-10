import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Ban, Check, Clock, Info, Leaf, Share2, Sparkles, Star, TriangleAlert } from 'lucide-react';
import { useSeo } from '@/hooks/useSeo';
import { useCart } from '@/lib/api/cart';
import { useStore } from '@/lib/api/store';
import { isApiError } from '@/lib/api/errors';
import type { ProductDetail } from '@/lib/api/types';
import {
  Badge,
  Breadcrumbs,
  Button,
  Container,
  EmptyState,
  ErrorState,
  Money,
  Rating,
  Skeleton,
  toast,
} from '@/design';
import { useProductDetail } from '../api';
import { unavailableText } from '../availability';
import { BranchSelector } from '../components/BranchSelector';
import { Customiser } from '../components/Customiser';
import { FavoriteButton } from '../components/FavoriteButton';
import { ProductGallery } from '../components/ProductGallery';
import { ProductCard } from '../components/ProductCard';
import { ReviewsSection } from '../components/ReviewsSection';
import { humanize } from '../filters';
import { useSelectedBranch } from '../useSelectedBranch';

function ProductSkeleton() {
  return (
    <Container size="wide" className="py-8">
      <div className="grid gap-10 lg:grid-cols-2" aria-busy="true" aria-label="Loading product">
        <Skeleton className="aspect-square w-full" />
        <div className="grid content-start gap-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </Container>
  );
}

function Availability({ product }: { product: ProductDetail }) {
  const { branch } = useSelectedBranch();
  const text = unavailableText(product, branch?.name);
  if (text)
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-md bg-neutral-bg px-3.5 py-2.5 text-sm font-medium text-neutral"
      >
        <Ban aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          {text}.{' '}
          {product.unavailable_reason === 'branch_unavailable'
            ? 'Choose another branch to order it.'
            : 'Check back soon.'}
        </span>
      </p>
    );
  if (!branch) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-text-muted">
      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
      <span>
        Available at <span className="font-medium text-text">{branch.name}</span>
        {branch.prep_minutes ? (
          <> · ready in about {product.prep_minutes || branch.prep_minutes} min</>
        ) : null}
      </span>
    </p>
  );
}

function ShareButton({ name }: { name: string }) {
  const share = async () => {
    const url = window.location.href.split('#')[0] as string;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to your clipboard');
    } catch (error) {
      // Dismissing the native share sheet is not an error.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error('We could not share this page. Copy the address from your browser instead.');
    }
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void share()}
      leadingIcon={<Share2 aria-hidden="true" className="size-4" />}
    >
      Share
    </Button>
  );
}

function FlagBadges({ product }: { product: ProductDetail }) {
  const f = product.flags;
  if (!f) return null;
  return (
    <>
      {f.is_new ? (
        <Badge tone="accent">
          <Sparkles aria-hidden="true" /> New
        </Badge>
      ) : null}
      {f.is_seasonal ? (
        <Badge tone="success">
          <Leaf aria-hidden="true" /> Seasonal
        </Badge>
      ) : null}
      {f.is_bestseller ? (
        <Badge tone="solid">
          <Star aria-hidden="true" /> Bestseller
        </Badge>
      ) : null}
    </>
  );
}

function Disclosure({ product }: { product: ProductDetail }) {
  const nutrition = Object.entries(product.nutrition ?? {}).filter(
    ([, v]) => typeof v === 'string' || typeof v === 'number',
  ) as Array<[string, string | number]>;
  const rows: Array<[string, string]> = [];
  if (product.calories != null) rows.push(['Calories', `${product.calories} kcal`]);
  if (product.caffeine_mg != null) rows.push(['Caffeine', `${product.caffeine_mg} mg`]);
  for (const [k, v] of nutrition) {
    if (k === 'serving_size') continue;
    rows.push([humanize(k), String(v)]);
  }
  const serving = product.nutrition?.serving_size;
  const allergens = product.allergens ?? [];

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <section aria-labelledby="allergens-title">
        <h3 id="allergens-title" className="font-display text-h4 font-semibold">
          Allergens
        </h3>
        {allergens.length ? (
          <>
            <p className="mt-1 text-sm text-text-muted">Contains:</p>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {allergens.map((a) => (
                <li key={a}>
                  <Badge tone="warning">
                    <TriangleAlert aria-hidden="true" /> {humanize(a)}
                  </Badge>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-text-muted">No declared allergens.</p>
        )}
        <p className="mt-3 text-sm text-text-muted">
          Made in a kitchen that also handles milk, gluten, nuts and soy. Ask us if you need detail.
        </p>
      </section>
      {rows.length > 0 ? (
        <section aria-labelledby="nutrition-title">
          <h3 id="nutrition-title" className="font-display text-h4 font-semibold">
            Nutrition &amp; caffeine
          </h3>
          <dl className="mt-2.5 grid gap-1.5 text-[0.9375rem]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-border pb-1.5">
                <dt className="text-text-muted">{k}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-text-muted">
            {typeof serving === 'string' ? `${serving}. ` : ''}Values are estimates and vary with
            the options you choose.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function ProductView({ product }: { product: ProductDetail }) {
  const [params] = useSearchParams();
  const editId = Number(params.get('edit')) || null;
  const cart = useCart();
  const store = useStore();
  const editItem = useMemo(
    () => (editId ? cart.data?.items.find((i) => i.id === editId) : undefined),
    [editId, cart.data],
  );
  const editValid = editItem && editItem.product.slug === product.slug ? editItem : undefined;
  const editMissing = Boolean(editId) && cart.isSuccess && !editValid;

  const images = useMemo(() => {
    const out: Array<{ url: string | null; alt: string }> = [];
    if (product.image) out.push({ url: product.image, alt: product.name });
    for (const g of product.gallery ?? [])
      if (g.url && g.url !== product.image)
        out.push({ url: g.url, alt: g.alt_text || product.name });
    return out;
  }, [product]);

  const categoryName = product.category?.name;
  const canonical = `/p/${product.slug}`;
  const available = product.is_available !== false;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Mirrors the server-rendered shell (apps/core/seo.py): name, description, category, offer. Aggregate ratings are
  // left to the shell because it excludes seeded demo reviews, which must never be advertised as real.
  const jsonLd = useMemo(
    () => [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.short_description || product.description || product.name,
        category: categoryName,
        ...(store.data ? { brand: { '@type': 'Brand', name: store.data.brand_name } } : {}),
        ...(product.image ? { image: [`${origin}${product.image}`] } : {}),
        offers: {
          '@type': 'Offer',
          url: `${origin}${canonical}`,
          price: product.base_price,
          priceCurrency: store.data?.currency ?? 'USD',
          availability: `https://schema.org/${available ? 'InStock' : 'OutOfStock'}`,
        },
      },
    ],
    [product, categoryName, store.data, origin, canonical, available],
  );
  useSeo({
    title: product.name,
    description: product.short_description || product.description?.slice(0, 160),
    image: product.image,
    canonical,
    type: 'product',
    jsonLd,
  });

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Menu', to: '/menu' },
    ...(product.category
      ? [{ label: product.category.name, to: `/menu/${product.category.slug}` }]
      : []),
    { label: product.name },
  ];
  const rating = product.reviews;

  return (
    <>
      <Container size="wide" className="pt-6 lg:pt-8">
        <Breadcrumbs items={crumbs} />
      </Container>

      <Container size="wide" className="py-6 lg:py-10">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:self-start">
            <ProductGallery images={images} name={product.name} />
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
            <header className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 empty:hidden">
                <FlagBadges product={product} />
              </div>
              <h1 className="text-h1">{product.name}</h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <p className="font-display text-2xl font-medium">
                  {product.has_options ? (
                    <span className="mr-1.5 font-sans text-base font-normal text-text-muted">
                      From
                    </span>
                  ) : null}
                  <Money value={product.base_price} />
                </p>
                {rating && rating.count > 0 && rating.average !== null ? (
                  <a href="#reviews" className="rounded-xs underline-offset-4 hover:underline">
                    <Rating value={rating.average} count={rating.count} showValue />
                  </a>
                ) : null}
              </div>
              {product.short_description ? (
                <p className="text-lead text-text-muted">{product.short_description}</p>
              ) : null}
              {product.tags?.length ? (
                <ul className="flex flex-wrap gap-2" aria-label="Tags">
                  {product.tags.map((t) => (
                    <li key={t.slug}>
                      <Link
                        to={`/menu?tag=${t.slug}`}
                        className="inline-flex h-7 items-center rounded-pill border border-border-strong px-3 text-xs font-medium text-text-muted transition-colors hover:border-text hover:text-text"
                      >
                        {humanize(t.name)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </header>

            <div className="grid gap-3 rounded-lg border border-border bg-surface-raised p-4">
              <Availability product={product} />
              <BranchSelector
                variant="bar"
                className="border-0 bg-transparent px-0 hover:border-0"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <FavoriteButtonLabelled product={product} />
              <ShareButton name={product.name} />
            </div>

            {editId ? (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-md border border-info/30 bg-info-bg p-3.5 text-sm text-info"
              >
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {cart.isPending
                  ? 'Loading your cart item…'
                  : editMissing
                    ? 'That cart item is no longer in your cart, so you are adding a new one.'
                    : 'You are editing an item in your cart. Save to update it.'}
              </div>
            ) : null}

            <div id="customise" className="scroll-mt-28">
              {editId && cart.isPending ? (
                <Skeleton className="h-80" />
              ) : (
                <Customiser
                  key={editValid ? `edit-${editValid.id}` : 'new'}
                  product={product}
                  editItem={editValid}
                />
              )}
            </div>
          </div>
        </div>
      </Container>

      <Container size="wide" className="py-10 lg:py-14">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {product.description ? (
            <section aria-labelledby="about-title">
              <h2 id="about-title" className="text-h3">
                About this {product.product_type === 'BEVERAGE' ? 'drink' : 'item'}
              </h2>
              <div className="mt-4 grid max-w-prose gap-4 text-[1.0625rem] leading-relaxed">
                {product.description.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
              {product.prep_minutes ? (
                <p className="mt-5 flex items-center gap-2 text-sm text-text-muted">
                  <Clock aria-hidden="true" className="size-4" /> Prepared in about{' '}
                  {product.prep_minutes} minutes
                </p>
              ) : null}
            </section>
          ) : null}
          <Disclosure product={product} />
        </div>
      </Container>

      <div className="border-t border-border bg-surface-sunken/40">
        <Container size="wide" className="py-14 lg:py-20">
          <ReviewsSection
            slug={product.slug}
            productName={product.name}
            summary={product.reviews}
          />
        </Container>
      </div>

      {product.related && product.related.length > 0 ? (
        <Container size="wide" className="py-14 lg:py-20">
          <section aria-labelledby="related-title">
            <h2 id="related-title" className="text-h2">
              You might also like
            </h2>
            <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-9 lg:grid-cols-4 lg:gap-x-6">
              {product.related.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <ProductCard product={p} aspect="1/1" showAdd />
                </li>
              ))}
            </ul>
          </section>
        </Container>
      ) : null}
    </>
  );
}

/** Heart with a visible label (the card heart is icon only). */
function FavoriteButtonLabelled({ product }: { product: ProductDetail }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised pr-3.5 text-sm font-medium">
      <FavoriteButton productId={product.id} productName={product.name} className="shadow-none" />
      Favorite
    </span>
  );
}

function ProductNotFound() {
  useSeo({ title: 'Product not found', noindex: true });
  return (
    <Container className="py-16">
      <EmptyState
        as="h1"
        title="We could not find that product"
        description="It may have been retired from the menu. Here is everything else we make."
        action={
          <Button asChild>
            <Link to="/menu">Browse the menu</Link>
          </Button>
        }
      />
    </Container>
  );
}

export default function ProductPage() {
  const { slug } = useParams();
  const { branchSlug, isReady } = useSelectedBranch();
  const detail = useProductDetail(slug, branchSlug, isReady);
  const missing = detail.isError && isApiError(detail.error) && detail.error.status === 404;

  if (missing) return <ProductNotFound />;
  if (detail.isError)
    return (
      <Container className="py-16">
        <ErrorState
          error={detail.error}
          onRetry={() => void detail.refetch()}
          retrying={detail.isFetching}
        />
      </Container>
    );
  if (!detail.data) return <ProductSkeleton />;
  return <ProductView key={detail.data.slug} product={detail.data} />;
}
