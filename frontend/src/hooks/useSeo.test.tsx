import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { configureSeo } from '@/lib/seo';
import { useSeo } from './useSeo';
import type { SeoInput } from '@/lib/seo';

function Page(props: SeoInput) {
  useSeo(props);
  return null;
}
const meta = (sel: string) => document.head.querySelector(sel)?.getAttribute('content');

beforeEach(() => {
  document.head.innerHTML = '<meta name="description" content="original">';
  document.title = 'Original';
  configureSeo({
    siteName: 'Lantern Coffee Roasters',
    tagline: 'Slow-roasted.',
    defaultImage: null,
  });
});

describe('useSeo', () => {
  it('sets title, description, canonical, robots and social tags', () => {
    window.history.pushState({}, '', '/p/flat-white?x=1');
    render(<Page title="Flat White" description="Silky." image="/media/ff.webp" type="product" />);
    expect(document.title).toBe('Flat White | Lantern Coffee Roasters');
    expect(meta('meta[name="description"]')).toBe('Silky.');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${window.location.origin}/p/flat-white`,
    );
    expect(meta('meta[name="robots"]')).toBe('index, follow');
    expect(meta('meta[property="og:title"]')).toBe('Flat White | Lantern Coffee Roasters');
    expect(meta('meta[property="og:type"]')).toBe('product');
    expect(meta('meta[property="og:image"]')).toBe(`${window.location.origin}/media/ff.webp`);
    expect(meta('meta[name="twitter:card"]')).toBe('summary_large_image');
  });

  it('supports noindex and an explicit canonical', () => {
    render(<Page title="Cart" noindex canonical="/cart" />);
    expect(meta('meta[name="robots"]')).toBe('noindex, nofollow');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${window.location.origin}/cart`,
    );
  });

  it('uses the site default title when none is given and never duplicates the site name', () => {
    const { rerender } = render(<Page />);
    expect(document.title).toBe('Lantern Coffee Roasters | Slow-roasted.');
    rerender(<Page title="About Lantern Coffee Roasters" />);
    expect(document.title).toBe('About Lantern Coffee Roasters');
  });

  it('injects JSON-LD safely and removes everything on unmount, restoring previous values', () => {
    const { unmount } = render(
      <Page title="X" jsonLd={{ '@type': 'Thing', name: '</script><b>' }} />,
    );
    const script = document.head.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(script?.textContent).not.toContain('</script>');
    expect(JSON.parse(script?.textContent ?? '{}')).toEqual({
      '@type': 'Thing',
      name: '</script><b>',
    });
    unmount();
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(document.title).toBe('Original');
    expect(meta('meta[name="description"]')).toBe('original');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('updates tags when props change', () => {
    const { rerender } = render(<Page title="One" />);
    rerender(<Page title="Two" />);
    expect(document.title).toBe('Two | Lantern Coffee Roasters');
  });
});
