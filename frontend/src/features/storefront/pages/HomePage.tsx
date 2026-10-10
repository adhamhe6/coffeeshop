import { useBranches } from '@/lib/api/branches';
import { useContentBlocks } from '@/lib/api/content';
import { activeSocialLinks, useStore } from '@/lib/api/store';
import { useSeo } from '@/hooks/useSeo';
import { Bestsellers } from '../home/Bestsellers';
import { BeansMerch } from '../home/BeansMerch';
import { CategoryMosaic } from '../home/CategoryMosaic';
import { CustomiseCup } from '../home/CustomiseCup';
import { FeaturedRail } from '../home/FeaturedRail';
import { Hero } from '../home/Hero';
import { LocationsPreview } from '../home/LocationsPreview';
import { NewsletterBand } from '../home/NewsletterBand';
import { SeasonalBand } from '../home/SeasonalBand';
import { StorySections } from '../home/StorySections';
import { ValueStrip } from '../home/ValueStrip';

/** `/` — editorial landing page. All editable copy comes from `content/blocks/`; every section degrades gracefully. */
export default function HomePage() {
  const blocks = useContentBlocks();
  const branches = useBranches();
  const store = useStore();
  const hero = blocks.data?.['home.hero'];
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const brand = store.data?.brand_name ?? 'Lantern Coffee Roasters';

  useSeo({
    title: undefined,
    description: hero?.body || store.data?.tagline,
    image: hero?.image,
    canonical: '/',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: brand,
        url: `${origin}/`,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${origin}/search?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: brand,
        url: `${origin}/`,
        sameAs: activeSocialLinks(store.data).map((s) => s.url),
      },
    ],
  });

  const openBranch = branches.data?.find((b) => b.is_open_now) ?? branches.data?.[0];

  return (
    <>
      <Hero block={hero} branch={openBranch} loading={blocks.isPending} />
      <ValueStrip />
      <FeaturedRail />
      <CategoryMosaic />
      <Bestsellers />
      <SeasonalBand block={blocks.data?.['home.seasonal']} />
      <BeansMerch />
      <CustomiseCup />
      <StorySections blocks={blocks.data ?? {}} />
      <LocationsPreview />
      <NewsletterBand block={blocks.data?.['home.newsletter']} />
    </>
  );
}
