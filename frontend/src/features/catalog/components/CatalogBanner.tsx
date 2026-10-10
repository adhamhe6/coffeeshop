import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Breadcrumbs, Container, ProductImage, type Crumb } from '@/design';

interface CatalogBannerProps {
  crumbs: Crumb[];
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  image?: string | null;
  /** Extra line under the description (item count). */
  meta?: ReactNode;
  className?: string;
}

/**
 * Intro block for a menu view. With an image it becomes an editorial split (text + picture on a parchment band),
 * without one a plain heading block. The `h1` of the page.
 */
export function CatalogBanner({
  crumbs,
  eyebrow,
  title,
  description,
  image,
  meta,
  className,
}: CatalogBannerProps) {
  const text = (
    <div className={image ? 'max-w-xl' : 'max-w-3xl'}>
      <Breadcrumbs items={crumbs} className="mb-5" />
      {eyebrow ? <p className="eyebrow mb-3 text-accent-text">{eyebrow}</p> : null}
      <h1 className="text-h1">{title}</h1>
      {description ? <p className="mt-4 text-lead text-text-muted">{description}</p> : null}
      {meta ? <div className="mt-4 text-sm text-text-muted">{meta}</div> : null}
    </div>
  );
  if (!image)
    return (
      <Container size="wide" className={cn('pt-6 pb-4 lg:pt-10 lg:pb-6', className)}>
        {text}
      </Container>
    );
  return (
    <section className={cn('bg-surface-sunken/60', className)}>
      <Container
        size="wide"
        className="grid items-center gap-6 py-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:py-8"
      >
        {text}
        <ProductImage
          src={image}
          alt=""
          aspect="auto"
          priority
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="h-44 w-full sm:h-56 lg:aspect-[2/1] lg:h-auto"
        />
      </Container>
    </section>
  );
}
