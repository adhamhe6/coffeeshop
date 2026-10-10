import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Ban, Leaf, Plus, SlidersHorizontal, Sparkles, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/api/errors';
import { useAddToCart } from '@/lib/api/cart';
import type { ProductSummary } from '@/lib/api/types';
import { useCartSheet } from '@/features/cart/components/CartSheet';
import { Badge, Button, Money, ProductImage, Rating, Skeleton, toast, type Aspect } from '@/design';
import { unavailableBadge } from '../availability';
import { useSelectedBranch } from '../useSelectedBranch';
import { CustomiseDialog } from './CustomiseDialog';
import { FavoriteButton } from './FavoriteButton';

interface ProductCardProps {
  product: ProductSummary;
  /** Show on dark (espresso) backgrounds. */
  tone?: 'default' | 'inverse';
  aspect?: Aspect;
  /** Editorial rank (1-based) drawn over the image, used by the bestsellers row. */
  rank?: number;
  priority?: boolean;
  className?: string;
  sizes?: string;
  /** Show the add button: one-tap add for products without options, a customise dialog for the rest. */
  showAdd?: boolean;
}

/** Highest-priority status chip for the card (icon + text, never colour alone). */
function StatusChip({
  product,
  hideBestseller,
  branchName,
}: {
  product: ProductSummary;
  hideBestseller?: boolean;
  branchName?: string | null;
}) {
  const unavailable = unavailableBadge(product, branchName);
  if (unavailable)
    return (
      <Badge
        tone="neutral"
        className="h-auto min-h-6 max-w-full py-1 leading-tight whitespace-normal"
      >
        <Ban aria-hidden="true" /> {unavailable}
      </Badge>
    );
  if (product.flags?.is_new)
    return (
      <Badge tone="accent">
        <Sparkles aria-hidden="true" /> New
      </Badge>
    );
  if (product.flags?.is_seasonal)
    return (
      <Badge tone="success">
        <Leaf aria-hidden="true" /> Seasonal
      </Badge>
    );
  if (product.flags?.is_bestseller && !hideBestseller)
    return (
      <Badge tone="solid">
        <Star aria-hidden="true" /> Bestseller
      </Badge>
    );
  return null;
}

/**
 * Product tile for grids and rails. The title link is stretched over the whole card (single tab stop); the
 * favourite toggle sits above it.
 */
export function ProductCard({
  product,
  tone = 'default',
  aspect = '4/5',
  rank,
  priority,
  className,
  sizes,
  showAdd,
}: ProductCardProps) {
  const inverse = tone === 'inverse';
  const soldOut = product.is_available === false;
  const { branch } = useSelectedBranch();
  return (
    <article className={cn('group relative flex flex-col', className)}>
      <div className="relative">
        <ProductImage
          src={product.image}
          alt=""
          aspect={aspect}
          priority={priority}
          sizes={sizes ?? '(min-width: 1024px) 22vw, (min-width: 640px) 40vw, 70vw'}
          className="transition-transform duration-[var(--duration-slow)] ease-[var(--ease-emphasized)]"
          imgClassName={cn(
            'transition-transform duration-700 ease-[var(--ease-emphasized)] group-hover:scale-[1.03] motion-reduce:transition-none',
            soldOut && 'grayscale',
          )}
        />
        <div className="pointer-events-none absolute top-3 right-14 left-3">
          <StatusChip product={product} hideBestseller={Boolean(rank)} branchName={branch?.name} />
        </div>
        {showAdd && !soldOut ? <CardAdd product={product} /> : null}
        <FavoriteButton
          productId={product.id}
          productName={product.name}
          className="absolute top-2.5 right-2.5 z-10"
        />
        {rank ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-4 font-display text-5xl leading-none font-medium text-white [text-shadow:0_2px_18px_rgb(43_29_22/0.55)]"
          >
            {String(rank).padStart(2, '0')}
          </span>
        ) : null}
      </div>
      <div className="mt-3.5 flex flex-1 flex-col gap-1">
        <h3
          className={cn(
            'font-display text-[1.1875rem] leading-snug font-medium',
            inverse ? 'text-text-inverse' : 'text-text',
          )}
        >
          <Link
            to={`/p/${product.slug}`}
            className="rounded-xs after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
          >
            {product.name}
          </Link>
        </h3>
        {product.short_description ? (
          <p
            className={cn(
              'line-clamp-2 text-sm leading-relaxed',
              inverse ? 'text-text-inverse-muted' : 'text-text-muted',
            )}
          >
            {product.short_description}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2">
          <p
            className={cn(
              'text-[0.9375rem] font-medium',
              inverse ? 'text-text-inverse' : 'text-text',
              soldOut && 'text-text-muted',
            )}
          >
            {product.has_options ? (
              <span
                className={cn(
                  'mr-1 font-normal',
                  inverse ? 'text-text-inverse-muted' : 'text-text-muted',
                )}
              >
                From
              </span>
            ) : null}
            <Money value={product.base_price} />
          </p>
          {product.rating_count && product.rating_avg ? (
            <Rating
              value={product.rating_avg}
              count={product.rating_count}
              size="sm"
              compact
              className={inverse ? 'text-text-inverse-muted' : 'text-text-muted'}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Add control overlaid on the image. Products without modifier groups are added in one tap; anything with options
 * opens the customise dialog so required choices are never skipped.
 */
function CardAdd({ product }: { product: ProductSummary }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const add = useAddToCart();
  const { setOpen: setCartOpen } = useCartSheet();
  const customise = Boolean(product.has_options);

  const quickAdd = async () => {
    try {
      await add.mutateAsync({ product_id: product.id, quantity: 1, option_ids: [] });
      toast.success(`Added ${product.name} to your cart`, {
        action: { label: 'View cart', onClick: () => setCartOpen(true) },
      });
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'We could not add that to your cart. Please try again.',
      );
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        variant="primary"
        size="icon"
        loading={add.isPending}
        aria-label={customise ? `Customise ${product.name}` : `Add ${product.name} to cart`}
        aria-haspopup={customise ? 'dialog' : undefined}
        title={customise ? 'Customise' : 'Add to cart'}
        className="absolute right-2.5 bottom-2.5 z-10 rounded-full shadow-sm"
        onClick={() => (customise ? setOpen(true) : void quickAdd())}
      >
        {customise ? (
          <SlidersHorizontal aria-hidden="true" className="size-[1.125rem]" />
        ) : (
          <Plus aria-hidden="true" className="size-5" />
        )}
      </Button>
      {customise ? (
        <CustomiseDialog
          product={product}
          open={open}
          onOpenChange={setOpen}
          returnFocusTo={buttonRef}
        />
      ) : null}
    </>
  );
}

export function ProductCardSkeleton({
  aspect = '4/5',
  className,
}: {
  aspect?: Aspect;
  className?: string;
}) {
  const ratio = {
    '4/5': 'aspect-[4/5]',
    '1/1': 'aspect-square',
    '3/2': 'aspect-[3/2]',
    '4/3': 'aspect-[4/3]',
  } as Record<string, string>;
  return (
    <div className={cn('flex flex-col', className)} aria-hidden="true">
      <Skeleton className={cn('w-full', ratio[aspect] ?? 'aspect-[4/5]')} />
      <Skeleton className="mt-3.5 h-5 w-2/3" />
      <Skeleton className="mt-2 h-3.5 w-full" />
      <Skeleton className="mt-4 h-4 w-1/4" />
    </div>
  );
}
