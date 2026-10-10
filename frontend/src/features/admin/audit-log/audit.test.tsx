import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp, resetTestWorld } from '@/test/utils';
import { signInAsStaff } from '../people-kit/testing';
import { normalizeChanges, resourceLink } from './auditLogic';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 1,
  actor: 2,
  actor_label: 'admin@x.example',
  action: 'coupon.update',
  resource_type: 'promotions.Coupon',
  resource_id: '5',
  summary: 'Updated coupon AUTUMN15',
  changes: {
    value: ['10.00', '15.00'],
    is_active: { from: true, to: false },
    description: 'changed',
  },
  request_id: 'req-abc123',
  ip_address: '127.0.0.1',
  created_at: '2026-10-10T12:00:00Z',
  ...over,
});

const seen: URLSearchParams[] = [];
// Warm the lazily-loaded route chunk so the first test is not charged for compiling it.
beforeAll(async () => {
  await import('@/features/admin/audit-log/pages/AuditLogPage');
}, 60_000);

beforeEach(() => {
  resetTestWorld();
  signInAsStaff('ADMIN');
  seen.length = 0;
  server.use(
    http.get('/api/v1/admin/audit-logs/', ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ count: 45, next: null, previous: null, results: [entry()] });
    }),
  );
});

describe('change normalisation', () => {
  it('understands every shape the backend records', () => {
    expect(normalizeChanges('coupon.update', { value: ['10.00', '15.00'] })).toEqual([
      { field: 'value', kind: 'diff', from: '10.00', to: '15.00' },
    ]);
    expect(
      normalizeChanges('settings.update', { tax_rate: { from: '8', to: '9' }, logo: 'changed' }),
    ).toEqual([
      { field: 'tax_rate', kind: 'diff', from: '8', to: '9' },
      { field: 'logo', kind: 'note', value: 'Changed (content not recorded)' },
    ]);
    // a create snapshot with a 2-element list is a value, not a before/after pair
    expect(normalizeChanges('coupon.create', { category_ids: [1, 2] })).toEqual([
      { field: 'category_ids', kind: 'value', value: '1, 2' },
    ]);
    expect(normalizeChanges('x.update', null)).toEqual([]);
  });
  it('links resources to admin pages only where one exists', () => {
    expect(
      resourceLink({
        action: 'customer.suspend',
        resource_type: 'accounts.User',
        resource_id: '9',
      }),
    ).toBe('/admin/customers/9');
    expect(
      resourceLink({
        action: 'coupon.update',
        resource_type: 'promotions.Coupon',
        resource_id: '5',
      }),
    ).toBe('/admin/coupons/5');
    expect(
      resourceLink({ action: 'order.transition', resource_type: 'orders.Order', resource_id: '3' }),
    ).toBeNull();
  });
});

describe('audit log page', () => {
  it('maps every filter to the API query and keeps them while paging', async () => {
    renderApp('/admin/audit-log');
    await screen.findByText('Updated coupon AUTUMN15');
    expect(seen.at(-1)?.get('page')).toBe('1');

    await userEvent.type(screen.getByLabelText(/Search by person/), 'autumn');
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('autumn'));

    await userEvent.click(screen.getByRole('combobox', { name: 'Action' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Coupon edited' }));
    await waitFor(() => expect(seen.at(-1)?.get('action')).toBe('coupon.update'));

    await userEvent.click(screen.getByRole('combobox', { name: 'Resource type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Coupon' }));
    await waitFor(() => expect(seen.at(-1)?.get('resource_type')).toBe('promotions.Coupon'));

    await userEvent.type(screen.getByLabelText('Resource ID'), '5');
    await waitFor(() => expect(seen.at(-1)?.get('resource_id')).toBe('5'));

    fireDate(screen.getByLabelText('From date'), '2026-10-01');
    fireDate(screen.getByLabelText('To date'), '2026-10-31');
    await waitFor(() => {
      expect(seen.at(-1)?.get('date_from')).toBe('2026-10-01');
      expect(seen.at(-1)?.get('date_to')).toBe('2026-10-31');
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(seen.at(-1)?.get('page')).toBe('2'));
    expect(seen.at(-1)?.get('action')).toBe('coupon.update');
  });

  it('filters by person when their name is clicked and clears it again', async () => {
    renderApp('/admin/audit-log');
    await screen.findByText('Updated coupon AUTUMN15');
    await userEvent.click(screen.getByRole('button', { name: /Filter by admin@x.example/ }));
    await waitFor(() => expect(seen.at(-1)?.get('actor')).toBe('2'));
    await userEvent.click(await screen.findByRole('button', { name: 'Clear the person filter' }));
    await waitFor(() => expect(seen.at(-1)?.get('actor')).toBeNull());
  });

  it('expands an entry into a before/after table with a copyable request id, read-only', async () => {
    renderApp('/admin/audit-log');
    await screen.findByText('Updated coupon AUTUMN15');
    await userEvent.click(screen.getByRole('button', { name: /Details for Coupon edited/ }));
    const table = await screen.findByRole('table', { name: 'What changed' });
    const row = within(table).getByRole('row', { name: /Value/ });
    expect(row).toHaveTextContent('10.00');
    expect(row).toHaveTextContent('15.00');
    expect(within(table).getByText('Changed (content not recorded)')).toBeInTheDocument();
    expect(screen.getByText('req-abc123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy request ID' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in dashboard' })).toHaveAttribute(
      'href',
      '/admin/coupons/5',
    );
    // read-only: nothing that edits or deletes
    expect(
      screen.queryByRole('button', { name: /^(delete|edit|remove)\b/i }),
    ).not.toBeInTheDocument();
  });
});

function fireDate(input: HTMLElement, value: string) {
  // Date pickers cannot be typed into under jsdom; a change event is what the browser's picker emits.
  fireEvent.change(input, { target: { value } });
}
