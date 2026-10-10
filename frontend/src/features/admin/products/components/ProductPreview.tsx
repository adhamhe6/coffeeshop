import { useFormContext } from 'react-hook-form';
import { Link } from 'react-router';
import { Ban, Info } from 'lucide-react';
import { ProductCard } from '@/features/catalog/components/ProductCard';
import { Badge, Money, ProductImage } from '@/design';
import type { AdminModifierGroup } from '@/lib/api/adminCatalog';
import type { ProductSummary } from '@/lib/api/types';
import { normalisePrice, toPayload, type ProductFormValues } from '../productForm';
import { GroupPreview } from './GroupPreview';
import { useEditor } from './editorContext';
import { useObjectUrl } from './useObjectUrl';

const humanKey = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * What the product looks like to customers, built from the unsaved form values: the real storefront `ProductCard`
 * plus a product-page layout assembled from the same design components. Everything is inert (no clicks, no cart).
 */
export function ProductPreview() {
  const { product, categories, groups, staged } = useEditor();
  const { watch } = useFormContext<ProductFormValues>();
  const v = watch();
  const stagedUrl = useObjectUrl(staged.main);
  const category = categories.find((c) => String(c.id) === v.category);
  const attached = v.modifier_group_ids
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is AdminModifierGroup => g !== undefined && g.is_active);
  const price = normalisePrice(v.base_price) ?? '0.00';
  const nutrition = toPayload(v).nutrition ?? {};
  const available = v.is_active && !v.is_sold_out;
  const image = stagedUrl ?? product?.image ?? null;

  const summary: ProductSummary = {
    id: product?.id ?? 0,
    slug: v.slug || product?.slug || 'preview',
    name: v.name || 'Untitled product',
    short_description: v.short_description,
    base_price: price,
    image,
    category: category ? { slug: category.slug, name: category.name } : null,
    flags: {
      is_featured: v.is_featured,
      is_bestseller: v.is_bestseller,
      is_seasonal: v.is_seasonal,
      is_new: v.is_new,
    },
    product_type: v.product_type,
    stock_mode: v.stock_mode,
    allergens: v.allergens,
    has_options: attached.length > 0,
    is_available: available,
  };

  return (
    <div className="grid gap-5" data-testid="product-preview">
      <p className="flex items-start gap-2 rounded-md bg-info-bg p-3 text-sm text-info">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        This is how the product appears to customers with your current, unsaved edits.
        {!v.is_active ? ' It is archived, so customers will not see it at all.' : ''}
      </p>
      <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <section aria-labelledby="preview-card" className="grid content-start gap-2">
          <h2 id="preview-card" className="text-sm font-medium">
            On the menu
          </h2>
          <div inert className="rounded-lg border border-border bg-surface p-3">
            <ProductCard product={summary} />
          </div>
        </section>
        <section aria-labelledby="preview-page" className="grid content-start gap-2">
          <h2 id="preview-page" className="text-sm font-medium">
            Product page
          </h2>
          <div inert className="rounded-lg border border-border bg-surface p-4 sm:p-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="grid content-start gap-2">
                <ProductImage src={image} alt="" aspect="1/1" />
                {product?.gallery.length ? (
                  <ul className="grid grid-cols-5 gap-1.5">
                    {product.gallery.slice(0, 5).map((g) => (
                      <li key={g.id}>
                        <ProductImage src={g.url} alt="" aspect="1/1" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="grid content-start gap-3">
                <p className="text-sm text-text-muted">
                  <Link to="/menu" tabIndex={-1}>
                    Menu
                  </Link>{' '}
                  / {category?.name ?? 'Category'}
                </p>
                <h3 className="font-display text-h3 font-medium">{v.name || 'Untitled product'}</h3>
                <p className="text-lg font-medium">
                  {attached.length ? (
                    <span className="mr-1 font-normal text-text-muted">From</span>
                  ) : null}
                  <Money value={price} />
                </p>
                {!available ? (
                  <Badge tone="neutral" className="w-fit">
                    <Ban aria-hidden="true" /> {v.is_active ? 'Sold out' : 'Unavailable'}
                  </Badge>
                ) : null}
                {v.short_description ? (
                  <p className="text-text-muted">{v.short_description}</p>
                ) : null}
                {attached.map((g) => (
                  <GroupPreview key={g.id} group={g} />
                ))}
                <button
                  type="button"
                  disabled
                  className="h-11 rounded-md bg-accent px-5 font-medium text-accent-foreground opacity-60"
                >
                  Add to cart
                </button>
              </div>
            </div>
            {v.description ? (
              <div className="mt-6 grid gap-2 border-t border-border pt-4">
                {v.description
                  .split(/\n{2,}/)
                  .filter(Boolean)
                  .map((para, i) => (
                    <p key={i} className="max-w-prose text-[0.9375rem] leading-relaxed">
                      {para}
                    </p>
                  ))}
              </div>
            ) : null}
            <dl className="mt-6 grid gap-x-8 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
              {v.allergens.length ? (
                <div className="flex gap-2">
                  <dt className="font-medium">Allergens</dt>
                  <dd className="text-text-muted">{v.allergens.join(', ')}</dd>
                </div>
              ) : null}
              {v.calories ? (
                <div className="flex gap-2">
                  <dt className="font-medium">Calories</dt>
                  <dd className="text-text-muted">{v.calories} kcal</dd>
                </div>
              ) : null}
              {v.caffeine_mg ? (
                <div className="flex gap-2">
                  <dt className="font-medium">Caffeine</dt>
                  <dd className="text-text-muted">{v.caffeine_mg} mg</dd>
                </div>
              ) : null}
              {v.prep_minutes ? (
                <div className="flex gap-2">
                  <dt className="font-medium">Ready in</dt>
                  <dd className="text-text-muted">about {v.prep_minutes} min</dd>
                </div>
              ) : null}
              {Object.entries(nutrition).map(([k, val]) => (
                <div key={k} className="flex gap-2">
                  <dt className="font-medium">{humanKey(k)}</dt>
                  <dd className="text-text-muted">{String(val)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
