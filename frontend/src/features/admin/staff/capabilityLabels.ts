import type { RoleInfo } from '@/lib/api/peopleTypes';

/** Plain-language names for capability groups and capabilities (the backend only sends the raw strings). */
export const CAPABILITY_GROUPS: Record<string, string> = {
  dashboard: 'Overview',
  orders: 'Orders',
  payments: 'Payments',
  customers: 'Customers',
  catalog: 'Catalogue',
  inventory: 'Inventory',
  reviews: 'Reviews',
  promotions: 'Promotions',
  content: 'Website content',
  branches: 'Branches',
  reports: 'Reports',
  settings: 'Store settings',
  staff: 'Staff accounts',
  audit: 'Audit log',
};

export const CAPABILITY_LABELS: Record<string, string> = {
  'dashboard.view': 'See the overview dashboard',
  'orders.view': 'View orders',
  'orders.manage': 'Move orders through their statuses',
  'orders.cancel': 'Cancel orders',
  'orders.note': 'Add internal notes to orders',
  'payments.view': 'View payments',
  'payments.refund': 'Issue refunds',
  'payments.collect': 'Mark cash payments as received',
  'customers.view': 'View customers',
  'customers.manage': 'Suspend and restore customers',
  'catalog.view': 'View products and categories',
  'catalog.manage': 'Create and edit products, categories and options',
  'inventory.view': 'View stock levels',
  'inventory.manage': 'Adjust stock and availability',
  'reviews.moderate': 'Approve or reject reviews',
  'promotions.manage': 'Create and edit coupons and promotions',
  'content.manage': 'Edit pages, homepage blocks, announcements and social links',
  'branches.view': 'View branches',
  'branches.manage': 'Edit branches, opening hours and delivery zones',
  'reports.view': 'View reports',
  'reports.export': 'Export report data',
  'settings.manage': 'Change store settings',
  'staff.manage': 'Manage staff accounts and roles',
  'audit.view': 'Read the audit log',
};

export const groupOf = (capability: string) => capability.split('.')[0] ?? capability;

const humanise = (s: string) => s.replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const capabilityLabel = (capability: string) =>
  CAPABILITY_LABELS[capability] ?? humanise(capability);

export const groupLabel = (group: string) => CAPABILITY_GROUPS[group] ?? humanise(group);

export interface CapabilityGroup {
  group: string;
  label: string;
  capabilities: string[];
}

/** Capabilities from the API, bucketed by area in a stable, readable order. */
export function groupCapabilities(capabilities: readonly string[]): CapabilityGroup[] {
  const order = Object.keys(CAPABILITY_GROUPS);
  const buckets = new Map<string, string[]>();
  for (const c of capabilities) {
    const g = groupOf(c);
    buckets.set(g, [...(buckets.get(g) ?? []), c]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([group, caps]) => ({ group, label: groupLabel(group), capabilities: caps }));
}

/** Short explanation of a role's branch scope. */
export const branchScopeLabel = (role: Pick<RoleInfo, 'is_global' | 'branch_required'>) =>
  role.is_global ? 'All branches' : role.branch_required ? 'Assigned branches' : 'Any branches';
