export interface SeoInput {
  /** Page title without the site name; the site name is appended. Omit for the default title. */
  title?: string;
  description?: string;
  /** Root-relative or absolute image URL for social cards. */
  image?: string | null;
  /** Path (`/p/flat-white`) or absolute URL. Defaults to the current path without query/hash. */
  canonical?: string;
  noindex?: boolean;
  type?: 'website' | 'article' | 'product';
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export const seoConfig = {
  siteName: 'Lantern Coffee Roasters',
  tagline: 'Slow-roasted. Carefully poured.',
  defaultDescription:
    'Slow-roasted coffee, carefully poured. Order drinks, beans and merch from Lantern Coffee Roasters for pickup or delivery.',
  defaultImage: null as string | null,
};

export function configureSeo(next: Partial<typeof seoConfig>) {
  Object.assign(
    seoConfig,
    Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)),
  );
}

const absolute = (value: string) => new URL(value, window.location.origin).toString();

export function formatTitle(title?: string): string {
  if (!title) return `${seoConfig.siteName} | ${seoConfig.tagline}`;
  return title.includes(seoConfig.siteName) ? title : `${title} | ${seoConfig.siteName}`;
}

type Restore = () => void;

function upsertMeta(attr: 'name' | 'property', key: string, content: string): Restore {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const created = !el;
  const previous = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (created) el?.remove();
    else if (previous !== null) el?.setAttribute('content', previous);
  };
}

function upsertCanonical(href: string): Restore {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const created = !el;
  const previous = el?.getAttribute('href') ?? null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  return () => {
    if (created) el?.remove();
    else if (previous !== null) el?.setAttribute('href', previous);
  };
}

/** Apply head tags; returns a function restoring whatever was there before. */
export function applySeo(input: SeoInput): Restore {
  const restores: Restore[] = [];
  const title = formatTitle(input.title);
  const description = input.description ?? seoConfig.defaultDescription;
  const image = input.image ?? seoConfig.defaultImage;
  const canonical = absolute(input.canonical ?? window.location.pathname);

  const previousTitle = document.title;
  document.title = title;
  restores.push(() => {
    document.title = previousTitle;
  });

  restores.push(upsertMeta('name', 'description', description));
  restores.push(upsertCanonical(canonical));
  restores.push(
    upsertMeta('name', 'robots', input.noindex ? 'noindex, nofollow' : 'index, follow'),
  );
  restores.push(upsertMeta('property', 'og:title', title));
  restores.push(upsertMeta('property', 'og:description', description));
  restores.push(
    upsertMeta(
      'property',
      'og:type',
      input.type === 'product' ? 'product' : (input.type ?? 'website'),
    ),
  );
  restores.push(upsertMeta('property', 'og:url', canonical));
  restores.push(upsertMeta('property', 'og:site_name', seoConfig.siteName));
  restores.push(upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary'));
  restores.push(upsertMeta('name', 'twitter:title', title));
  restores.push(upsertMeta('name', 'twitter:description', description));
  if (image) {
    restores.push(upsertMeta('property', 'og:image', absolute(image)));
    restores.push(upsertMeta('name', 'twitter:image', absolute(image)));
  }

  if (input.jsonLd) {
    const blocks = Array.isArray(input.jsonLd) ? input.jsonLd : [input.jsonLd];
    for (const block of blocks) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.seo = 'jsonld';
      // `<` is escaped so a value like "</script>" can never terminate the tag.
      script.textContent = JSON.stringify(block).replace(/</g, '\\u003c');
      document.head.appendChild(script);
      restores.push(() => script.remove());
    }
  }
  return () => restores.reverse().forEach((r) => r());
}
