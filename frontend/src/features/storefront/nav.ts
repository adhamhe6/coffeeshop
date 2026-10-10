export interface NavItem {
  label: string;
  to: string;
  /** Extra query that must be present for this item to count as active (`seasonal=true`). */
  match?: { path: string; query?: Record<string, string> };
}

/**
 * Primary storefront navigation (header + mobile drawer + footer "Shop").
 * "Seasonal" and "Beans" are filtered views of /menu until dedicated routes exist.
 */
export const PRIMARY_NAV: NavItem[] = [
  { label: 'Menu', to: '/menu', match: { path: '/menu' } },
  {
    label: 'Seasonal',
    to: '/menu?seasonal=true',
    match: { path: '/menu', query: { seasonal: 'true' } },
  },
  { label: 'Beans', to: '/menu?type=BEANS', match: { path: '/menu', query: { type: 'BEANS' } } },
  { label: 'Locations', to: '/locations', match: { path: '/locations' } },
  { label: 'About', to: '/about', match: { path: '/about' } },
];

export const SUPPORT_NAV: NavItem[] = [
  { label: 'Contact', to: '/contact' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Refund policy', to: '/refund-policy' },
];

export const LEGAL_NAV: NavItem[] = [
  { label: 'Privacy', to: '/privacy' },
  { label: 'Terms', to: '/terms' },
];

/** Is `item` the current page? Menu is active on /menu* and product pages only when no special filter applies. */
export function isNavActive(item: NavItem, pathname: string, search: string): boolean {
  const m = item.match;
  if (!m) return pathname === item.to;
  const params = new URLSearchParams(search);
  const onPath =
    pathname === m.path ||
    pathname.startsWith(`${m.path}/`) ||
    (m.path === '/menu' && pathname.startsWith('/p/'));
  if (!onPath) return false;
  if (m.query) return Object.entries(m.query).every(([k, v]) => params.get(k) === v);
  // Plain "Menu" must not light up for the Seasonal / Beans filtered views.
  return !(params.get('seasonal') === 'true' || params.get('type') === 'BEANS');
}
