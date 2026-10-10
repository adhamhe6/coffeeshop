import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp, resetTestWorld } from '@/test/utils';
import { signInAsStaff } from '../people-kit/testing';

const A = '/api/v1/admin';

const row = (over: Record<string, unknown> = {}) => ({
  id: 9,
  email: 'alex@x.example',
  full_name: 'Alex Morgan',
  first_name: 'Alex',
  last_name: 'Morgan',
  phone: '+1 555 010 0201',
  marketing_opt_in: true,
  is_active: true,
  date_joined: '2026-01-01T00:00:00Z',
  last_login: null,
  order_count: 3,
  lifetime_spend: '42.50',
  last_order_at: '2026-10-01T10:00:00Z',
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...row(),
  restriction_reason: '',
  addresses: [
    {
      id: 1,
      label: 'Home',
      recipient_name: 'Alex Morgan',
      phone: '',
      line1: '14 Sample Street',
      line2: '',
      city: 'Harbour City',
      postal_code: '00000',
      zone_name: 'Old Town',
      instructions: '',
      is_default: true,
    },
  ],
  recent_orders: [
    {
      number: 'DT-261007-D001',
      status: 'COMPLETED',
      payment_status: 'PAID',
      order_type: 'PICKUP',
      total: '12.50',
      currency: 'USD',
      branch_name: 'Downtown',
      placed_at: '2026-10-07T10:00:00Z',
    },
  ],
  ...over,
});

beforeEach(() => resetTestWorld());

describe('customer list', () => {
  it('sends search, status filter, sort and page to the API and shows the totals', async () => {
    signInAsStaff('SUPPORT_AGENT');
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`${A}/customers/`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ count: 41, next: null, previous: null, results: [row()] });
      }),
    );
    renderApp('/admin/customers');
    await screen.findByRole('link', { name: 'Alex Morgan' });
    expect(screen.getByText('41 customers')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Search customers/), 'alex');
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('alex'));

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by account status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Suspended only' }));
    await waitFor(() => expect(seen.at(-1)?.get('is_active')).toBe('false'));

    await userEvent.click(screen.getByRole('button', { name: /Lifetime spend/i }));
    await waitFor(() => expect(seen.at(-1)?.get('ordering')).toBe('lifetime_spend'));

    await userEvent.click(await screen.findByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(seen.at(-1)?.get('page')).toBe('2'));
    // filters survive paging
    expect(seen.at(-1)?.get('search')).toBe('alex');
  });
});

describe('suspend / restore flow', () => {
  it('requires a reason, sends it, and then offers Restore', async () => {
    signInAsStaff('SUPER_ADMIN');
    let customer = detail();
    let suspendBody: unknown;
    server.use(
      http.get(`${A}/customers/9/`, () => HttpResponse.json(customer)),
      http.post(`${A}/customers/9/suspend/`, async ({ request }) => {
        suspendBody = await request.json();
        customer = detail({ is_active: false, restriction_reason: 'Chargeback abuse' });
        return HttpResponse.json(customer);
      }),
      http.post(`${A}/customers/9/restore/`, () => {
        customer = detail();
        return HttpResponse.json(customer);
      }),
    );
    renderApp('/admin/customers/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend account' }));
    const dialog = await screen.findByRole('dialog', { name: /Suspend Alex Morgan/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }));
    expect(await within(dialog).findByText('Enter a reason to continue.')).toBeInTheDocument();
    expect(suspendBody).toBeUndefined();

    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Chargeback abuse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }));
    await waitFor(() => expect(suspendBody).toEqual({ reason: 'Chargeback abuse' }));
    expect(await screen.findByText('This account is suspended')).toBeInTheDocument();
    expect(screen.getByText('Chargeback abuse')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore account' }));
    const confirm = await screen.findByRole('dialog', { name: /Restore Alex Morgan/ });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Restore account' }));
    await waitFor(() =>
      expect(screen.queryByText('This account is suspended')).not.toBeInTheDocument(),
    );
  });

  it('shows the profile with order links and hides suspend for staff without customers.manage', async () => {
    signInAsStaff('SUPPORT_AGENT');
    server.use(http.get(`${A}/customers/9/`, () => HttpResponse.json(detail())));
    renderApp('/admin/customers/9');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Alex Morgan' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suspend account/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'DT-261007-D001' })).toHaveAttribute(
      'href',
      '/admin/orders/DT-261007-D001',
    );
    expect(screen.getByText(/14 Sample Street/)).toBeInTheDocument();
    expect(screen.getByText(/Delivery zone: Old Town/)).toBeInTheDocument();
    expect(screen.queryByText(/password|hash/i)).not.toBeInTheDocument();
  });

  it('shows the server message when the suspension fails', async () => {
    signInAsStaff('SUPER_ADMIN');
    server.use(
      http.get(`${A}/customers/9/`, () => HttpResponse.json(detail())),
      http.post(`${A}/customers/9/suspend/`, () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Not allowed right now.', request_id: 'r' } },
          { status: 403 },
        ),
      ),
    );
    renderApp('/admin/customers/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend account' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not allowed right now.');
  });
});
