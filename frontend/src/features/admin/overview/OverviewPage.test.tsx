import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAdminOps, signInAsStaff } from '@/mocks/adminOps';
import { renderApp, resetTestWorld } from '@/test/utils';

// The admin area is a lazy chunk: the first render in a file pays for the dynamic import.
configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 30_000 });
// The admin area is lazy-loaded: pre-load the chunks so a slow first import cannot time a test out.
beforeAll(async () => {
  await import('@/app/layouts/AdminLayout');
  await import('@/features/admin/overview/pages/OverviewPage');
}, 60_000);

beforeEach(() => {
  resetTestWorld();
  signInAsStaff();
});

const lastDashboardRequest = (requests: ReturnType<typeof mockAdminOps>['requests']) =>
  [...requests].reverse().find((r) => r.url.pathname.endsWith('/admin/dashboard/'));

describe('overview KPI strip', () => {
  it('renders each KPI with its value, the previous period and an Up/Down change that is not colour-only', async () => {
    mockAdminOps();
    renderApp('/admin');
    const gross = (await screen.findByText('Gross sales')).closest('div.rounded-lg') as HTMLElement;
    await waitFor(() => expect(within(gross).getByText('$1,989.60')).toBeInTheDocument());
    expect(within(gross).getByText('$1,365.60')).toBeInTheDocument(); // previous period
    expect(within(gross).getByText(/45\.7%/)).toBeInTheDocument();
    expect(within(gross).getByText('Up')).toBeInTheDocument(); // spoken direction, not only an arrow/colour

    const refunds = screen.getByText('Refunds').closest('div.rounded-lg') as HTMLElement;
    expect(within(refunds).getByText('Down')).toBeInTheDocument();
    expect(within(refunds).getByText(/79\.4%/)).toBeInTheDocument();
  });

  it('shows the server definition of a metric when its info button is used', async () => {
    mockAdminOps();
    renderApp('/admin');
    await screen.findByText('$1,954.28');
    await userEvent.click(
      await screen.findByRole('button', { name: /What does “Net sales” mean\?/ }),
    );
    expect(await screen.findByText('Gross sales - discounts - refunds.')).toBeInTheDocument();
  });

  it('flags demo data and shows the period the API used', async () => {
    mockAdminOps();
    renderApp('/admin');
    expect(await screen.findByText('Demo data.')).toBeInTheDocument();
    expect(screen.getByTestId('period-summary')).toHaveTextContent('Sep 11, 2026 – Oct 10, 2026');
  });

  it('shows the error state with a retry when the dashboard request fails', async () => {
    const { server } = await import('@/mocks/server');
    const { http, HttpResponse } = await import('msw');
    mockAdminOps();
    server.use(
      http.get('/api/v1/admin/dashboard/', () =>
        HttpResponse.json({ error: { code: 'server_error', message: 'Boom' } }, { status: 500 }),
      ),
    );
    renderApp('/admin');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('overview filters', () => {
  it('sends the chosen preset as date_from/date_to and the branch as `branch`', async () => {
    const { requests } = mockAdminOps();
    renderApp('/admin');
    await screen.findByText('$1,954.28');

    await userEvent.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => {
      const q = lastDashboardRequest(requests)?.url.searchParams;
      expect(q?.get('date_from')).toBe(q?.get('date_to'));
    });

    await userEvent.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    await waitFor(() => {
      const q = lastDashboardRequest(requests)!.url.searchParams;
      expect(q.get('date_from')).not.toBe(q.get('date_to'));
    });

    await userEvent.click(screen.getByRole('combobox', { name: 'Branch' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Riverside' }));
    await waitFor(() =>
      expect(lastDashboardRequest(requests)!.url.searchParams.get('branch')).toBe('2'),
    );
  });

  it('keeps the filters in the URL and sends a custom range', async () => {
    const { requests } = mockAdminOps();
    const { router } = renderApp('/admin?range=custom&from=2026-09-01&to=2026-09-15&gran=week');
    await screen.findByText('$1,954.28');
    const q = lastDashboardRequest(requests)!.url.searchParams;
    expect(q.get('date_from')).toBe('2026-09-01');
    expect(q.get('date_to')).toBe('2026-09-15');
    expect(q.get('granularity')).toBe('week');
    await userEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    await waitFor(() => expect(router.state.location.search).toContain('gran=month'));
  });

  it('does not call the API for an invalid custom range and explains why', async () => {
    mockAdminOps();
    renderApp('/admin?range=custom&from=2026-09-20&to=2026-09-01');
    expect(
      await screen.findByText('The start date must be on or before the end date.'),
    ).toBeInTheDocument();
  });
});

describe('role-aware widgets', () => {
  it('links attention rows to the filtered pages', async () => {
    mockAdminOps();
    renderApp('/admin');
    const stuck = await screen.findByRole('link', { name: 'Review stuck orders' });
    expect(stuck).toHaveAttribute('href', '/admin/orders?view=table&stuck=true');
    expect(screen.getByRole('link', { name: 'Review failed payments' })).toHaveAttribute(
      'href',
      '/admin/payments?failed=true',
    );
    expect(screen.getByRole('link', { name: 'Review refunds needed' })).toHaveAttribute(
      'href',
      '/admin/payments?needs_refund=true',
    );
  });

  it('hides attention rows and links the role cannot open', async () => {
    signInAsStaff(['dashboard.view', 'orders.view']);
    mockAdminOps();
    renderApp('/admin');
    await screen.findByRole('link', { name: 'Review stuck orders' });
    expect(screen.queryByText('Failed payments')).not.toBeInTheDocument();
    expect(screen.queryByText('Low or out of stock')).not.toBeInTheDocument();
    expect(screen.queryByText('New customers')).toBeInTheDocument(); // data is present, only links are gated
  });
});
