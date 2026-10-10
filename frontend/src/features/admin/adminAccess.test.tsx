import { configure, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminCrumbs } from './components/AdminBreadcrumbs';
import { adminNavFor } from './nav.test-helpers';
import { mockAdminOps, signInAsStaff } from '@/mocks/adminOps';
import { renderApp, resetTestWorld } from '@/test/utils';

configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 30_000 });
// The admin area is lazy-loaded: pre-load the chunks so a slow first import cannot time a test out.
beforeAll(async () => {
  await import('@/app/layouts/AdminLayout');
  await import('@/features/admin/overview/pages/OverviewPage');
  await import('@/features/admin/orders/pages/OrdersQueuePage');
}, 60_000);

beforeEach(resetTestWorld);

// Capability sets copied from backend/apps/accounts/permissions.py ROLE_CAPABILITIES (the source of truth).
const ROLES: Record<string, string[]> = {
  ORDER_MANAGER: [
    'dashboard.view',
    'catalog.view',
    'inventory.view',
    'orders.view',
    'orders.manage',
    'orders.cancel',
    'orders.note',
    'payments.view',
    'payments.collect',
    'customers.view',
  ],
  SUPPORT_AGENT: [
    'dashboard.view',
    'orders.view',
    'orders.note',
    'payments.view',
    'customers.view',
    'catalog.view',
  ],
  MARKETING_MANAGER: [
    'dashboard.view',
    'catalog.view',
    'promotions.manage',
    'content.manage',
    'reviews.moderate',
    'reports.view',
  ],
  INVENTORY_MANAGER: [
    'dashboard.view',
    'catalog.view',
    'inventory.view',
    'inventory.manage',
    'branches.view',
    'reports.view',
  ],
};

describe('capability-based navigation', () => {
  it('shows each role only the sections its capabilities allow', () => {
    const order = adminNavFor(ROLES.ORDER_MANAGER!);
    expect(order).toEqual(expect.arrayContaining(['Overview', 'Orders', 'Payments', 'Inventory']));
    expect(order).not.toContain('Reports');
    expect(order).not.toContain('Settings');
    expect(order).not.toContain('Staff');

    const support = adminNavFor(ROLES.SUPPORT_AGENT!);
    expect(support).toEqual(expect.arrayContaining(['Orders', 'Payments']));
    expect(support).not.toContain('Inventory');
    expect(support).not.toContain('Reports');

    const marketing = adminNavFor(ROLES.MARKETING_MANAGER!);
    expect(marketing).toContain('Reports');
    expect(marketing).not.toContain('Orders');
    expect(marketing).not.toContain('Payments');
  });

  it('renders only permitted links in the real sidebar', async () => {
    signInAsStaff(ROLES.SUPPORT_AGENT!, null, 'SUPPORT_AGENT');
    mockAdminOps();
    renderApp('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    expect(within(nav).getByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Inventory' })).not.toBeInTheDocument();
  });
});

describe('route guard (direct URL access)', () => {
  it.each([
    ['SUPPORT_AGENT', '/admin/reports'],
    ['MARKETING_MANAGER', '/admin/orders'],
    ['MARKETING_MANAGER', '/admin/payments'],
    ['ORDER_MANAGER', '/admin/reports'],
  ])(
    '%s opening %s sees a proper 403 state, not the page and not a blank screen',
    async (role, path) => {
      signInAsStaff(ROLES[role]!, null, role);
      mockAdminOps();
      renderApp(path);
      expect(
        await screen.findByRole('heading', { name: 'You do not have access to this page' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
        'href',
        '/admin',
      );
      // the shell (navigation) is still there so the person can move on
      expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
    },
  );

  it('lets a permitted role through', async () => {
    signInAsStaff(ROLES.ORDER_MANAGER!, null, 'ORDER_MANAGER');
    mockAdminOps();
    renderApp('/admin/orders?view=table');
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  });
});

describe('layout helpers', () => {
  it('builds breadcrumbs from the nav labels and the order number', () => {
    expect(adminCrumbs('/admin/orders/DT-261010-D005')).toEqual([
      { label: 'Admin', to: '/admin' },
      { label: 'Orders', to: '/admin/orders' },
      { label: 'DT-261010-D005', to: undefined },
    ]);
    expect(adminCrumbs('/admin/reports')).toEqual([
      { label: 'Admin', to: '/admin' },
      { label: 'Reports', to: undefined },
    ]);
  });

  it('shows the branch scope of a limited staff member in the top bar', async () => {
    signInAsStaff(ROLES.ORDER_MANAGER!, [1, 2], 'ORDER_MANAGER');
    mockAdminOps();
    renderApp('/admin/orders');
    expect(await screen.findByText('Downtown Flagship, Riverside')).toBeInTheDocument();
  });
});
