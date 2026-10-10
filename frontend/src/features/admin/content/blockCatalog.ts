export type BlockField = 'eyebrow' | 'title' | 'body' | 'image' | 'cta';
export type BlockLayout = 'hero' | 'story' | 'band';

export interface BlockInfo {
  label: string;
  /** Plain-language description of where visitors see it. */
  where: string;
  /** Page the block appears on, for the "View on site" link. */
  href?: string;
  layout: BlockLayout;
  /** Fields the storefront actually displays for this block. `null` = not shown anywhere yet. */
  fields: BlockField[] | null;
}

/**
 * Where each homepage block key is rendered. Mirrors `features/storefront/home/*` (hero, story/sourcing rows,
 * newsletter band). Unknown keys fall back to a generic description.
 */
export const BLOCK_CATALOG: Record<string, BlockInfo> = {
  'home.hero': {
    label: 'Homepage hero',
    where: 'The large banner at the very top of the homepage.',
    href: '/',
    layout: 'hero',
    fields: ['eyebrow', 'title', 'body', 'image', 'cta'],
  },
  'home.story': {
    label: 'Our story',
    where: 'The first story section on the homepage, with a photo beside the text.',
    href: '/',
    layout: 'story',
    fields: ['eyebrow', 'title', 'body', 'image', 'cta'],
  },
  'home.sourcing': {
    label: 'Sourcing',
    where: 'The second story section on the homepage (photo on the other side).',
    href: '/',
    layout: 'story',
    fields: ['eyebrow', 'title', 'body', 'image', 'cta'],
  },
  'home.newsletter': {
    label: 'Newsletter sign-up',
    where:
      'The newsletter band near the bottom of the homepage. Only the small heading and title are shown.',
    href: '/',
    layout: 'band',
    fields: ['eyebrow', 'title'],
  },
  'home.craft': {
    label: 'Roasting (not shown yet)',
    where: 'Reserved for a future homepage section. Editing it has no visible effect today.',
    layout: 'story',
    fields: null,
  },
  'home.loyalty': {
    label: 'For regulars (not shown yet)',
    where: 'Reserved for a future homepage section. Editing it has no visible effect today.',
    layout: 'story',
    fields: null,
  },
};

export const blockInfo = (key: string): BlockInfo =>
  BLOCK_CATALOG[key] ?? {
    label: key,
    where: 'A custom block. Where it appears depends on the page that uses this key.',
    layout: 'story',
    fields: ['eyebrow', 'title', 'body', 'image', 'cta'],
  };
