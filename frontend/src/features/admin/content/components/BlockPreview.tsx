import { ArrowRight } from 'lucide-react';
import { ProductImage } from '@/design';
import { cn } from '@/lib/cn';
import { blockInfo } from '../blockCatalog';

export interface BlockPreviewValues {
  eyebrow: string;
  title: string;
  body: string;
  cta_label: string;
  cta_url: string;
  imageUrl: string | null;
  active: boolean;
}

/** Approximation of how the storefront lays out each block key. Text only; no raw HTML. */
export function BlockPreview({
  blockKey,
  values,
}: {
  blockKey: string;
  values: BlockPreviewValues;
}) {
  const info = blockInfo(blockKey);
  const paragraphs = values.body.split(/\n{2,}/).filter(Boolean);
  const cta = values.cta_url ? (
    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4">
      {values.cta_label || 'Learn more'} <ArrowRight aria-hidden="true" className="size-3.5" />
    </span>
  ) : null;

  return (
    <figure
      aria-label={`Preview of ${info.label}`}
      className={cn(
        'overflow-hidden rounded-lg border border-border',
        !values.active && 'opacity-60',
      )}
    >
      {info.layout === 'hero' ? (
        <div
          data-surface="dark"
          className="relative isolate bg-espresso p-6 text-text-inverse sm:p-8"
        >
          {values.imageUrl ? (
            <ProductImage
              src={values.imageUrl}
              alt=""
              aspect="16/9"
              className="absolute inset-0 -z-10 size-full opacity-35"
            />
          ) : null}
          <p className="text-xs font-semibold tracking-[0.14em] text-accent-on-dark uppercase">
            {values.eyebrow || 'Eyebrow'}
          </p>
          <p className="mt-3 max-w-md font-display text-3xl leading-tight">
            {values.title || 'Headline'}
          </p>
          {values.body ? (
            <p className="mt-3 max-w-md text-sm text-text-inverse-muted">{values.body}</p>
          ) : null}
          {cta}
        </div>
      ) : info.layout === 'band' ? (
        <div className="bg-surface-raised p-6 sm:p-8">
          <p className="text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">
            {values.eyebrow || 'The newsletter'}
          </p>
          <p className="mt-3 font-display text-2xl leading-tight">
            {values.title || 'Letters from the roastery'}
          </p>
          <p className="mt-3 rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-text-muted">
            Email sign-up form appears here.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 bg-surface-raised p-5 sm:grid-cols-2 sm:p-6">
          <ProductImage src={values.imageUrl} alt="" aspect="4/5" className="rounded-md" />
          <div className="self-center">
            <p className="text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">
              {values.eyebrow || 'Eyebrow'}
            </p>
            <p className="mt-3 font-display text-2xl leading-tight">{values.title || 'Headline'}</p>
            <div className="mt-3 grid gap-2 text-sm text-text-muted">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {cta}
          </div>
        </div>
      )}
      <figcaption className="border-t border-border bg-surface-sunken px-4 py-2 text-xs text-text-muted">
        {values.active
          ? 'Preview of the section. The live site may differ slightly in fonts and spacing.'
          : 'This block is switched off, so the site uses its built-in default text instead.'}
      </figcaption>
    </figure>
  );
}
