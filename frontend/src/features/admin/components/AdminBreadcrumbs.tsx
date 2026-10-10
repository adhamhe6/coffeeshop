import { useLocation } from 'react-router';
import { Breadcrumbs, type Crumb } from '@/design';
import { ADMIN_NAV } from '../nav';

const LABEL_BY_PATH = new Map(
  ADMIN_NAV.flatMap((g) => g.items.map((i) => [i.to, i.label] as const)),
);

/** `/admin/orders/DT-1` → Admin / Orders / DT-1. Section names come from the nav, so they never drift. */
export function adminCrumbs(pathname: string): Crumb[] {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'admin') return [];
  const crumbs: Crumb[] = [{ label: 'Admin', to: '/admin' }];
  if (parts.length === 1) return [{ label: 'Admin' }, { label: 'Overview' }];
  const section = `/admin/${parts[1]}`;
  const sectionLabel = LABEL_BY_PATH.get(section) ?? decodeURIComponent(parts[1] ?? '');
  crumbs.push({ label: sectionLabel, to: parts.length > 2 ? section : undefined });
  for (let i = 2; i < parts.length; i++) {
    const raw = decodeURIComponent(parts[i] ?? '');
    const label = raw === 'new' ? 'New' : raw;
    crumbs.push({
      label,
      to: i < parts.length - 1 ? `/${parts.slice(0, i + 1).join('/')}` : undefined,
    });
  }
  return crumbs;
}

export function AdminBreadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = adminCrumbs(pathname);
  if (crumbs.length < 2) return null;
  return <Breadcrumbs items={crumbs} className="min-w-0 truncate" />;
}
