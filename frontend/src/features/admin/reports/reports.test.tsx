import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAdminOps, signInAsStaff } from '@/mocks/adminOps';
import { renderApp, resetTestWorld } from '@/test/utils';

configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 30_000 });
// The admin area is lazy-loaded: pre-load the chunks so a slow first import cannot time a test out.
beforeAll(async () => {
  await import('@/app/layouts/AdminLayout');
  await import('@/features/admin/reports/pages/ReportsPage');
  await import('@/features/admin/overview/pages/OverviewPage');
}, 60_000);

beforeEach(() => {
  resetTestWorld();
  signInAsStaff();
});

describe('reports page', () => {
  it('renders the sales table with a totals row from the API (not summed in the browser)', async () => {
    mockAdminOps();
    renderApp('/admin/reports');
    const table = await screen.findByRole('table', { name: 'Sales by period' });
    const foot = (await within(table).findByText('Total')).closest('tr')!;
    // 6 + 8 orders in the fixture rows, but the API total (91) is what is shown.
    expect(within(foot).getByText('91')).toBeInTheDocument();
    expect(within(foot).getByText('$1,954.28')).toBeInTheDocument();
  });

  it('builds the CSV link from the same filters as the on-screen report', async () => {
    mockAdminOps();
    renderApp('/admin/reports?range=custom&from=2026-09-01&to=2026-09-15&branch=2&gran=week');
    const link = await screen.findByTestId('export-csv');
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/api/v1/admin/reports/sales/');
    expect(url.searchParams.get('format')).toBe('csv');
    expect(url.searchParams.get('date_from')).toBe('2026-09-01');
    expect(url.searchParams.get('date_to')).toBe('2026-09-15');
    expect(url.searchParams.get('branch')).toBe('2');
    expect(url.searchParams.get('granularity')).toBe('week');
    expect(link).toHaveAttribute('download');
  });

  it('uses the active tab and its sort order in the CSV link, without the page number', async () => {
    mockAdminOps();
    renderApp('/admin/reports?tab=products&ordering=-units&page=3');
    await screen.findByRole('table', { name: 'Product sales' });
    const url = new URL(screen.getByTestId('export-csv').getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/api/v1/admin/reports/products/');
    expect(url.searchParams.get('ordering')).toBe('-units');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('hides Export CSV from roles without reports.export', async () => {
    signInAsStaff(['dashboard.view', 'reports.view']);
    mockAdminOps();
    renderApp('/admin/reports');
    await screen.findByRole('table', { name: 'Sales by period' });
    expect(screen.queryByTestId('export-csv')).not.toBeInTheDocument();
  });

  it('switches report tabs, keeps the date filters, and requests that report', async () => {
    const { requests } = mockAdminOps();
    const { router } = renderApp('/admin/reports?range=7d');
    await screen.findByRole('table', { name: 'Sales by period' });
    await userEvent.click(screen.getByRole('tab', { name: 'Products' }));
    await screen.findByRole('table', { name: 'Product sales' });
    expect(router.state.location.search).toContain('tab=products');
    expect(router.state.location.search).toContain('range=7d');
    const q = requests.find((r) => r.url.pathname.endsWith('/reports/products/'))!.url.searchParams;
    expect(q.get('date_from')).toBeTruthy();
  });

  it('opens the definitions panel with the server wording', async () => {
    mockAdminOps();
    renderApp('/admin/reports');
    await userEvent.click(await screen.findByRole('button', { name: 'Definitions' }));
    const panel = await screen.findByRole('dialog', { name: 'What the numbers mean' });
    expect(
      await within(panel).findByText('Gross sales - discounts - refunds.'),
    ).toBeInTheDocument();
  });

  it('turns tables into stacked cards on a narrow screen and keeps the totals as a card', async () => {
    window.innerWidth = 390;
    mockAdminOps();
    renderApp('/admin/reports');
    await screen.findByRole('list', { name: 'Sales by period' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('shows the same totals as the overview for the same filters', async () => {
    mockAdminOps();
    const overview = renderApp('/admin');
    await screen.findByText('$1,954.28');
    overview.unmount();
    renderApp('/admin/reports');
    const table = await screen.findByRole('table', { name: 'Sales by period' });
    await waitFor(() => expect(within(table).getAllByText('$1,954.28').length).toBeGreaterThan(0));
  });
});
