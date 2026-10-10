import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp, resetTestWorld } from '@/test/utils';
import { signInAsStaff } from '../people-kit/testing';

const A = '/api/v1/admin';
const err = (status: number, code: string, message: string, fields?: Record<string, string[]>) =>
  HttpResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}), request_id: 'r1' } },
    { status },
  );

const coupon = (over: Record<string, unknown> = {}) => ({
  id: 5,
  code: 'AUTUMN15',
  name: 'Autumn favourites',
  description: '',
  discount_type: 'PERCENT',
  value: '15.00',
  max_discount: '6.00',
  min_order_total: '10.00',
  applies_to: 'CATEGORIES',
  category_ids: [2],
  product_ids: [],
  first_order_only: false,
  is_automatic: false,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  per_customer_limit: null,
  times_redeemed: 4,
  total_discount: '5.10',
  redemption_count: 4,
  is_active: true,
  created_by_email: 'a@x.example',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

const categories = [
  { id: 2, name: 'Seasonal drinks', is_active: true },
  { id: 3, name: 'Pastries', is_active: true },
];

beforeEach(() => {
  resetTestWorld();
  signInAsStaff('MARKETING_MANAGER');
  server.use(
    http.get(`${A}/categories/`, () =>
      HttpResponse.json({ count: 2, next: null, previous: null, results: categories }),
    ),
    http.get(`${A}/products/`, () =>
      HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
    ),
  );
});

describe('coupon form', () => {
  it('validates required fields before sending anything', async () => {
    let posted = false;
    server.use(
      http.post(
        `${A}/coupons/`,
        () => ((posted = true), HttpResponse.json(coupon(), { status: 201 })),
      ),
    );
    renderApp('/admin/coupons/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Create coupon' }));
    expect(
      await screen.findByText('Give the coupon a name staff will recognise.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Enter the code customers will type/)).toBeInTheDocument();
    expect(screen.getByText('Enter the discount amount.')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('rejects percentages above 100 and end dates before the start', async () => {
    renderApp('/admin/coupons/new');
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Big');
    await userEvent.type(screen.getByLabelText(/^Code/), 'BIG100');
    await userEvent.type(screen.getByLabelText(/^Percent off/), '150');
    await userEvent.type(screen.getByLabelText('Starts'), '2026-12-02T10:00');
    await userEvent.type(screen.getByLabelText('Ends'), '2026-12-01T10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }));
    expect(await screen.findByText('A percentage cannot be more than 100.')).toBeInTheDocument();
    expect(screen.getByText('The end must be after the start.')).toBeInTheDocument();
  });

  it('previews a plain-language summary live and posts the exact payload', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${A}/coupons/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(coupon({ id: 9, code: 'AUTUMN15' }), { status: 201 });
      }),
      http.get(`${A}/coupons/`, () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    );
    const { router } = renderApp('/admin/coupons/new');
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Autumn favourites');
    await userEvent.type(screen.getByLabelText(/^Code/), 'autumn15');
    await userEvent.type(screen.getByLabelText(/^Percent off/), '15');
    await userEvent.type(screen.getByLabelText('Maximum discount'), '6');
    await userEvent.type(screen.getByLabelText('Minimum order'), '10');
    await userEvent.click(screen.getByRole('radio', { name: 'Selected categories' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seasonal drinks' }));

    await waitFor(() =>
      expect(screen.getByTestId('coupon-summary')).toHaveTextContent(
        'Customers enter AUTUMN15: 15% off Seasonal drinks, max $6.00, orders of $10.00 or more.',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/coupons'));
    expect(body).toMatchObject({
      code: 'AUTUMN15',
      name: 'Autumn favourites',
      discount_type: 'PERCENT',
      value: '15.00',
      max_discount: '6.00',
      min_order_total: '10.00',
      applies_to: 'CATEGORIES',
      category_ids: [2],
      product_ids: [],
      starts_at: null,
      ends_at: null,
      is_active: true,
    });
  });

  it('maps server field errors back onto the fields', async () => {
    server.use(
      http.post(`${A}/coupons/`, () =>
        err(400, 'validation_error', 'Please correct the highlighted fields.', {
          code: ['A coupon with this code already exists.'],
        }),
      ),
    );
    renderApp('/admin/coupons/new');
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Dupe');
    await userEvent.type(screen.getByLabelText(/^Code/), 'WELCOME10');
    await userEvent.type(screen.getByLabelText(/^Percent off/), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }));
    const code = screen.getByLabelText(/^Code/);
    await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'));
    expect(code).toHaveAccessibleDescription(/already exists/);
  });

  it('generates a code on request', async () => {
    renderApp('/admin/coupons/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    expect((screen.getByLabelText(/^Code/) as HTMLInputElement).value).toMatch(
      /^LANTERN-[A-Z0-9]{5}$/,
    );
  });
});

describe('deleting a redeemed coupon (409 coupon_has_redemptions)', () => {
  it('shows the server message and offers to deactivate instead', async () => {
    let patched: unknown;
    server.use(
      http.get(`${A}/coupons/5/`, () =>
        HttpResponse.json(coupon({ times_redeemed: 0, redemption_count: 0 })),
      ),
      http.delete(`${A}/coupons/5/`, () =>
        err(
          409,
          'coupon_has_redemptions',
          'This coupon has been redeemed, so it cannot be deleted. Deactivate it instead.',
        ),
      ),
      http.patch(`${A}/coupons/5/`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json(coupon({ is_active: false }));
      }),
      http.get(`${A}/coupons/`, () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    );
    renderApp('/admin/coupons/5');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete AUTUMN15/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete coupon' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/has been redeemed/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate instead' }));
    await waitFor(() => expect(patched).toEqual({ is_active: false }));
  });
});

describe('coupon list', () => {
  it('shows status chips (with icons and text), usage and discount given', async () => {
    const list = [
      coupon({ id: 1, code: 'LIVE', name: 'Live' }),
      coupon({ id: 2, code: 'SOON', name: 'Soon', starts_at: '2999-01-01T00:00:00Z' }),
      coupon({ id: 3, code: 'OLD', name: 'Old', ends_at: '2020-01-01T00:00:00Z' }),
      coupon({ id: 4, code: 'FULL', name: 'Full', usage_limit: 4, times_redeemed: 4 }),
      coupon({ id: 6, code: 'AUTO-1', name: 'Auto', is_automatic: true }),
    ];
    server.use(
      http.get(`${A}/coupons/`, () =>
        HttpResponse.json({ count: 5, next: null, previous: null, results: list }),
      ),
    );
    renderApp('/admin/coupons');
    const table = await screen.findByRole('table', { name: 'Coupons and promotions' });
    await within(table).findByText('LIVE');
    for (const label of ['Active', 'Scheduled', 'Expired', 'Exhausted', 'Automatic'])
      expect(within(table).getAllByText(label).length).toBeGreaterThan(0);
    expect(
      within(table).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '4 / 4'),
    ).toBeInTheDocument();
  });
});
