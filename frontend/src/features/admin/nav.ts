import {
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  History,
  Layers,
  type LucideIcon,
  MessageSquareText,
  Package,
  Percent,
  Settings,
  Share2,
  SlidersHorizontal,
  Tag,
  UserCog,
  Users,
} from 'lucide-react';

export interface AdminNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Capability required to see the entry (and to open the route). */
  capability: string;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/**
 * Single source for the admin sidebar AND the route capability guard (see app/router.tsx).
 * Capability strings come from backend `apps/accounts/permissions.py` via `auth/me/` → `staff.capabilities`.
 */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: 'Operations',
    items: [
      { label: 'Overview', to: '/admin', icon: Gauge, capability: 'dashboard.view' },
      { label: 'Orders', to: '/admin/orders', icon: ClipboardList, capability: 'orders.view' },
      { label: 'Payments', to: '/admin/payments', icon: CreditCard, capability: 'payments.view' },
      { label: 'Inventory', to: '/admin/inventory', icon: Boxes, capability: 'inventory.view' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Products', to: '/admin/products', icon: Package, capability: 'catalog.view' },
      { label: 'Categories', to: '/admin/categories', icon: Tag, capability: 'catalog.view' },
      {
        label: 'Options',
        to: '/admin/options',
        icon: SlidersHorizontal,
        capability: 'catalog.view',
      },
      { label: 'Collections', to: '/admin/collections', icon: Layers, capability: 'catalog.view' },
      {
        label: 'Reviews',
        to: '/admin/reviews',
        icon: MessageSquareText,
        capability: 'reviews.moderate',
      },
    ],
  },
  {
    label: 'Customers & marketing',
    items: [
      { label: 'Customers', to: '/admin/customers', icon: Users, capability: 'customers.view' },
      { label: 'Coupons', to: '/admin/coupons', icon: Percent, capability: 'promotions.manage' },
      { label: 'Content', to: '/admin/content', icon: FileText, capability: 'content.manage' },
      { label: 'Social links', to: '/admin/social', icon: Share2, capability: 'content.manage' },
    ],
  },
  {
    label: 'Insight & system',
    items: [
      { label: 'Reports', to: '/admin/reports', icon: BarChart3, capability: 'reports.view' },
      { label: 'Branches', to: '/admin/branches', icon: Building2, capability: 'branches.view' },
      { label: 'Staff', to: '/admin/staff', icon: UserCog, capability: 'staff.manage' },
      { label: 'Settings', to: '/admin/settings', icon: Settings, capability: 'settings.manage' },
      { label: 'Audit log', to: '/admin/audit-log', icon: History, capability: 'audit.view' },
    ],
  },
];

export const ADMIN_CAPABILITY_BY_PATH: Record<string, string> = Object.fromEntries(
  ADMIN_NAV.flatMap((g) => g.items.map((i) => [i.to, i.capability])),
);

/** Groups with only the entries `has(capability)` allows; empty groups are dropped. */
export function visibleAdminNav(has: (capability: string) => boolean): AdminNavGroup[] {
  return ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => has(i.capability)) })).filter(
    (g) => g.items.length > 0,
  );
}
