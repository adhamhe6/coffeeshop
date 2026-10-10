import { useEffect } from 'react';
import { applySeo, type SeoInput } from '@/lib/seo';

/**
 * Keep <head> in sync with the page: title, description, canonical, robots, Open Graph/Twitter and JSON-LD.
 * The Django SEO shell injects the same tags for crawlers; this keeps client-side navigation consistent.
 *
 *   useSeo({ title: product.name, description: product.short_description, image: product.image, type: 'product' })
 */
export function useSeo({
  title,
  description,
  image,
  canonical,
  noindex,
  type,
  jsonLd,
}: SeoInput): void {
  // Objects are compared by value so callers can pass inline literals without re-applying every render.
  const jsonKey = jsonLd ? JSON.stringify(jsonLd) : '';
  useEffect(
    () =>
      applySeo({
        title,
        description,
        image,
        canonical,
        noindex,
        type,
        jsonLd: jsonKey ? (JSON.parse(jsonKey) as SeoInput['jsonLd']) : undefined,
      }),
    [title, description, image, canonical, noindex, type, jsonKey],
  );
}
