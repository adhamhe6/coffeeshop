import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, it } from 'vitest';
import { server } from '@/mocks/server';
import { expectNoA11yViolations, renderApp, resetTestWorld } from '@/test/utils';
import { signInAsStaff } from './testing';

const A = '/api/v1/admin';
const empty = () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] });

beforeEach(() => {
  resetTestWorld();
  signInAsStaff('SUPER_ADMIN');
  server.use(
    http.get(`${A}/categories/`, empty),
    http.get(`${A}/products/`, empty),
    http.get(`${A}/coupons/`, empty),
    http.get(`${A}/social/`, empty),
    http.get(`${A}/customers/`, empty),
    http.get(`${A}/staff/`, empty),
    http.get(`${A}/staff/roles/`, () =>
      HttpResponse.json({
        capabilities: ['orders.view'],
        roles: [
          {
            role: 'ADMIN',
            label: 'Admin',
            capabilities: ['orders.view'],
            is_global: true,
            branch_required: false,
          },
        ],
      }),
    ),
  );
});

describe('admin people pages have no obvious accessibility violations', () => {
  it('coupon form', async () => {
    const { container } = renderApp('/admin/coupons/new');
    await screen.findByRole('button', { name: 'Create coupon' });
    await expectNoA11yViolations(container);
  });
  it('social links', async () => {
    const { container } = renderApp('/admin/social');
    await screen.findByRole('region', { name: 'Instagram' });
    await expectNoA11yViolations(container);
  });
  it('staff roles matrix', async () => {
    const { container } = renderApp('/admin/staff?tab=roles');
    await screen.findByRole('table', { name: /What each staff role/ });
    await expectNoA11yViolations(container);
  });
  it('customers list', async () => {
    const { container } = renderApp('/admin/customers');
    await screen.findByText('No customers yet');
    await expectNoA11yViolations(container);
  });
});
