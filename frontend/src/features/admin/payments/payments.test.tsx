import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockAdminOps, paymentDetail, signInAsStaff } from '@/mocks/adminOps';
import { renderApp, resetTestWorld } from '@/test/utils';

configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 30_000 });
// The admin area is lazy-loaded: pre-load the chunks so a slow first import cannot time a test out.
beforeAll(async () => {
  await import('@/app/layouts/AdminLayout');
  await import('@/features/admin/payments/pages/PaymentsPage');
}, 60_000);

beforeEach(() => {
  resetTestWorld();
  signInAsStaff();
});

const refundPosts = (r: ReturnType<typeof mockAdminOps>['requests']) =>
  r.filter((x) => x.method === 'POST' && x.url.pathname.endsWith('/refund/'));

async function openRefund(route = '/admin/payments?payment=243') {
  renderApp(route);
  await userEvent.click(await screen.findByRole('button', { name: 'Refund…' }));
  return screen.findByRole('dialog', { name: 'Refund payment' });
}

describe('payments list', () => {
  it('turns the quick filters into API params', async () => {
    const { requests } = mockAdminOps();
    renderApp('/admin/payments');
    await screen.findByText('DT-261010-D005');
    await userEvent.click(screen.getByRole('radio', { name: 'Needs refund' }));
    await waitFor(() => {
      const q = [...requests].reverse().find((r) => r.url.pathname.endsWith('/admin/payments/'))!
        .url.searchParams;
      expect(q.get('needs_refund')).toBe('true');
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Failed' }));
    await waitFor(() => {
      const q = [...requests].reverse().find((r) => r.url.pathname.endsWith('/admin/payments/'))!
        .url.searchParams;
      expect(q.get('failed')).toBe('true');
      expect(q.get('needs_refund')).toBeNull();
    });
  });

  it('honours filters linked from the overview (?failed=true) and marks sandbox payments in words', async () => {
    const { requests } = mockAdminOps({
      payments: [
        { ...paymentDetail({ provider: 'stripe', provider_label: 'Card (Stripe)' }) } as never,
      ],
    });
    renderApp('/admin/payments?failed=true');
    await screen.findByText('DT-261010-D005');
    expect(
      requests
        .find((r) => r.url.pathname.endsWith('/admin/payments/'))!
        .url.searchParams.get('failed'),
    ).toBe('true');
    expect(screen.getByRole('radio', { name: 'Failed' })).toBeChecked();
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
  });

  it('explains the Stripe limitation when a Stripe payment is listed but Stripe is not enabled', async () => {
    mockAdminOps({
      payments: [paymentDetail({ provider: 'stripe', provider_label: 'Card (Stripe)' }) as never],
    });
    renderApp('/admin/payments');
    expect(await screen.findByText(/Stripe is not set up in this environment/)).toBeInTheDocument();
  });
});

describe('refund dialog', () => {
  it('explains that refunds go through the provider and that cancelling does not refund', async () => {
    mockAdminOps({
      payment: paymentDetail({
        provider: 'stripe',
        provider_label: 'Card (Stripe)',
        provider_is_available: true,
      }),
    });
    const dialog = await openRefund();
    expect(within(dialog).getByText(/The refund is sent to Card \(Stripe\)/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Cancelling an order never refunds it by itself/),
    ).toBeInTheDocument();
  });

  it('validates the amount (more than remaining, zero, not a number) and the reason before calling the API', async () => {
    const { requests } = mockAdminOps();
    const dialog = await openRefund();
    const amount = within(dialog).getByLabelText(/Amount to refund/);

    await userEvent.clear(amount);
    await userEvent.type(amount, '99');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Test');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    expect(
      await within(dialog).findByText('The most you can refund is $27.44.'),
    ).toBeInTheDocument();

    await userEvent.clear(amount);
    await userEvent.type(amount, '0');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    expect(
      await within(dialog).findByText(/Enter an amount greater than zero/),
    ).toBeInTheDocument();

    await userEvent.clear(amount);
    await userEvent.type(amount, '5');
    await userEvent.clear(within(dialog).getByLabelText(/Reason/));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    expect(await within(dialog).findByText(/Enter a reason/)).toBeInTheDocument();
    expect(refundPosts(requests)).toHaveLength(0);
  });

  it('sends a partial amount with an Idempotency-Key and shows the succeeded outcome', async () => {
    const { requests } = mockAdminOps();
    const dialog = await openRefund();
    const amount = within(dialog).getByLabelText(/Amount to refund/);
    await userEvent.clear(amount);
    await userEvent.type(amount, '4.50');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Drink arrived cold');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    expect(await screen.findByRole('dialog', { name: 'Refund completed' })).toBeInTheDocument();
    const [req] = refundPosts(requests);
    expect(req?.body).toEqual({ amount: '4.50', reason: 'Drink arrived cold' });
    expect(req?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits the amount for a full refund (the server refunds everything left)', async () => {
    const { requests } = mockAdminOps();
    const dialog = await openRefund();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Duplicate charge');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    await screen.findByRole('dialog', { name: 'Refund completed' });
    expect(refundPosts(requests)[0]?.body).toEqual({ reason: 'Duplicate charge' });
  });

  it('explains a pending refund instead of calling it done', async () => {
    mockAdminOps({
      refund: (body) => ({
        refund: {
          id: 9,
          amount: '27.44',
          reason: body.reason,
          status: 'PENDING',
          reference: 're_9',
          failure_message: '',
          initiated_by: 'a@b.c',
          created_at: '2026-10-10T21:50:00Z',
          updated_at: '2026-10-10T21:50:00Z',
        },
        payment: paymentDetail(),
      }),
    });
    const dialog = await openRefund();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Goodwill');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    const done = await screen.findByRole('dialog', { name: 'Refund submitted' });
    expect(within(done).getByText(/waiting for the provider/)).toBeInTheDocument();
    expect(within(done).getByText(/Do not issue it again/)).toBeInTheDocument();
  });

  it('shows a provider failure honestly and lets the user try again with a NEW idempotency key', async () => {
    const keys: (string | null)[] = [];
    mockAdminOps({
      refund: (_body, key) => {
        keys.push(key);
        return apiError(502, 'refund_failed', 'The card network declined the refund.');
      },
    });
    const dialog = await openRefund();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Goodwill');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    const failed = await screen.findByRole('dialog', { name: 'Refund failed' });
    expect(within(failed).getByText('The card network declined the refund.')).toBeInTheDocument();
    expect(within(failed).getByText(/Nothing was returned to the customer/)).toBeInTheDocument();

    await userEvent.click(within(failed).getByRole('button', { name: 'Try again' }));
    const again = await screen.findByRole('dialog', { name: 'Refund payment' });
    await userEvent.type(within(again).getByLabelText(/Reason/), 'Goodwill');
    await userEvent.click(within(again).getByRole('button', { name: /^Refund/ }));
    await screen.findByRole('dialog', { name: 'Refund failed' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('keeps the SAME idempotency key when the response was lost (network error), so a retry cannot refund twice', async () => {
    const keys: (string | null)[] = [];
    const { server } = await import('@/mocks/server');
    const { http, HttpResponse } = await import('msw');
    mockAdminOps();
    server.use(
      http.post('/api/v1/admin/payments/:id/refund/', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return keys.length === 1
          ? HttpResponse.error()
          : HttpResponse.json({
              refund: {
                id: 1,
                amount: '27.44',
                reason: 'x',
                status: 'SUCCEEDED',
                reference: '',
                failure_message: '',
                initiated_by: null,
                created_at: '2026-10-10T21:50:00Z',
                updated_at: '2026-10-10T21:50:00Z',
              },
              payment: paymentDetail(),
            });
      }),
    );
    const dialog = await openRefund();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Goodwill');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    expect(
      await within(dialog).findByText(/we do not know whether the refund went through/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /^Refund/ }));
    await screen.findByRole('dialog', { name: 'Refund completed' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('cannot refund a Stripe payment when Stripe is unavailable and says why', async () => {
    mockAdminOps({
      payment: paymentDetail({
        provider: 'stripe',
        provider_label: 'Card (Stripe)',
        provider_is_available: false,
      }),
    });
    renderApp('/admin/payments?payment=243');
    expect(
      await screen.findByText(/Stripe is not configured in this environment/),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Refund…' })).toBeDisabled();
  });

  it('hides the refund control from roles without payments.refund', async () => {
    signInAsStaff(['dashboard.view', 'payments.view', 'orders.view']);
    mockAdminOps({ payment: paymentDetail({ can_refund: false }) });
    renderApp('/admin/payments?payment=243');
    await screen.findByText('Provider events');
    expect(screen.queryByRole('button', { name: 'Refund…' })).not.toBeInTheDocument();
  });
});
