import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  mockAdminOps,
  orderDetail,
  paymentDetail,
  signInAsStaff,
} from '@/mocks/adminOps';
import { renderApp, resetTestWorld } from '@/test/utils';

configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 30_000 });
// The admin area is lazy-loaded: pre-load the chunks so a slow first import cannot time a test out.
beforeAll(async () => {
  await import('@/app/layouts/AdminLayout');
  await import('@/features/admin/orders/pages/OrdersQueuePage');
  await import('@/features/admin/orders/pages/OrderDetailPage');
}, 60_000);

beforeEach(() => {
  resetTestWorld();
  signInAsStaff();
});

const posts = (r: ReturnType<typeof mockAdminOps>['requests'], suffix: string) =>
  r.filter((x) => x.method === 'POST' && x.url.pathname.endsWith(suffix));

describe('order action bar', () => {
  it('offers exactly the forward step the API allows, plus cancel', async () => {
    mockAdminOps({ order: orderDetail({ allowed_transitions: ['PREPARING', 'CANCELLED'] }) });
    renderApp('/admin/orders/DT-261010-D005');
    const bar = await screen.findByRole('group', { name: 'Order actions' });
    expect(within(bar).getByRole('button', { name: 'Start preparing' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole('button', { name: 'Mark cash collected' }),
    ).not.toBeInTheDocument();
  });

  it('hides actions the role may not use, and says why nothing is offered', async () => {
    mockAdminOps({
      order: orderDetail({
        permissions: {
          can_transition: false,
          can_cancel: false,
          can_note: false,
          can_refund: false,
          can_collect_cash: false,
        },
        payments: [paymentDetail({ can_refund: false })],
      }),
    });
    signInAsStaff(['dashboard.view', 'orders.view']);
    renderApp('/admin/orders/DT-261010-D005');
    const bar = await screen.findByRole('group', { name: 'Order actions' });
    expect(within(bar).queryByRole('button', { name: 'Start preparing' })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    expect(within(bar).getByText(/your role cannot change it/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a note')).not.toBeInTheDocument();
  });

  it('final orders have no forward actions', async () => {
    mockAdminOps({
      order: orderDetail({
        status: 'COMPLETED',
        allowed_transitions: [],
        payments: [paymentDetail({ can_refund: false })],
        permissions: {
          can_transition: false,
          can_cancel: false,
          can_note: true,
          can_refund: false,
          can_collect_cash: false,
        },
      }),
    });
    renderApp('/admin/orders/DT-261010-D005');
    expect(await screen.findByText(/This order is final/)).toBeInTheDocument();
  });

  it('performs the transition on the server and shows the new status from the response', async () => {
    const { requests } = mockAdminOps();
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Start preparing' }));
    await waitFor(() => expect(posts(requests, '/transition/')).toHaveLength(1));
    expect(posts(requests, '/transition/')[0]?.body).toEqual({ to_status: 'PREPARING', note: '' });
    // The heading badge reflects what the server returned.
    await waitFor(() =>
      expect(
        within(screen.getByRole('heading', { level: 1 })).getByText('Preparing'),
      ).toBeInTheDocument(),
    );
  });

  it('explains a 409 invalid_transition and reloads the order instead of pretending it worked', async () => {
    const { requests } = mockAdminOps({
      transition: () =>
        apiError(
          409,
          'invalid_transition',
          'Order is already PREPARING. Allowed next steps: READY_FOR_PICKUP.',
        ),
    });
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Start preparing' }));
    expect(await screen.findByText(/already PREPARING/)).toBeInTheDocument();
    const detailGets = requests.filter(
      (r) => r.method === 'GET' && r.url.pathname.endsWith('/orders/DT-261010-D005/'),
    );
    await waitFor(() => expect(detailGets.length).toBeGreaterThan(1)); // refetched after the failure
  });

  it('tells the user when the role is refused (403)', async () => {
    mockAdminOps({ transition: () => apiError(403, 'permission_denied', 'No.') });
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Start preparing' }));
    expect(await screen.findByText('Your role is not allowed to do that.')).toBeInTheDocument();
  });

  it('asks before recording cash and only then calls collect-cash', async () => {
    const { requests } = mockAdminOps({
      order: orderDetail({
        payment_method: 'cash',
        payment_status: 'PENDING',
        payments: [],
        permissions: {
          can_transition: true,
          can_cancel: true,
          can_note: true,
          can_refund: false,
          can_collect_cash: true,
        },
      }),
    });
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Mark cash collected' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark cash as collected?' });
    expect(posts(requests, '/collect-cash/')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, cash collected' }));
    await waitFor(() => expect(posts(requests, '/collect-cash/')).toHaveLength(1));
  });
});

describe('cancel dialog', () => {
  it('requires a reason and sends nothing until one is entered', async () => {
    const { requests } = mockAdminOps();
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog', { name: /Cancel order DT-261010-D005/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel order' }));
    expect(await within(dialog).findByText(/Enter a reason for cancelling/)).toBeInTheDocument();
    expect(posts(requests, '/cancel/')).toHaveLength(0);
  });

  it('shows the real refund outcome (succeeded) returned by the API after cancel + refund', async () => {
    const { requests } = mockAdminOps();
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason for cancelling/), 'Out of milk');
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /Also refund the payment/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel and refund' }));
    expect(await within(dialog).findByText('Refund succeeded')).toBeInTheDocument();
    expect(within(dialog).getByText('Refunded 27.44 USD through Sandbox.')).toBeInTheDocument();
    expect(posts(requests, '/cancel/')[0]?.body).toEqual({ reason: 'Out of milk', refund: true });
  });

  it.each([
    ['PENDING', 'Refund pending', 'waiting for the payment provider'],
    ['FAILED', 'Refund failed', 'Retry it from Payments'],
  ])('renders a %s refund outcome truthfully', async (status, title, message) => {
    const base = orderDetail();
    mockAdminOps({
      cancel: () =>
        ({
          order: { ...base, status: 'CANCELLED', allowed_transitions: [] },
          refund: {
            status,
            message: `The order is cancelled; ${message}.`,
            amount: '27.44',
            refund_id: 1,
            payment_id: 243,
          },
        }) as never,
    });
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason for cancelling/), 'Customer asked');
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /Also refund the payment/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel and refund' }));
    expect(await within(dialog).findByText(title)).toBeInTheDocument();
    expect(within(dialog).getByText(new RegExp(message))).toBeInTheDocument();
  });

  it('does not offer the refund checkbox to roles without payments.refund, and says cancelling does not refund', async () => {
    signInAsStaff(['dashboard.view', 'orders.view', 'orders.manage', 'orders.cancel']);
    mockAdminOps({
      order: orderDetail({
        permissions: {
          can_transition: true,
          can_cancel: true,
          can_note: false,
          can_refund: false,
          can_collect_cash: false,
        },
      }),
    });
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Cancelling does not refund it/)).toBeInTheDocument();
  });
});

describe('internal notes', () => {
  it('adds a note through the API and lists it', async () => {
    const { requests } = mockAdminOps();
    renderApp('/admin/orders/DT-261010-D005');
    await userEvent.type(await screen.findByLabelText('Add a note'), 'Customer called');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() =>
      expect(posts(requests, '/notes/')[0]?.body).toEqual({ body: 'Customer called' }),
    );
    expect(await screen.findByText('Customer called')).toBeInTheDocument();
  });
});

describe('printable ticket', () => {
  it('renders a clean ticket (print only) without internal notes', async () => {
    mockAdminOps({
      order: orderDetail({
        notes: [
          { id: 1, author: 'Sam', body: 'SECRET INTERNAL', created_at: '2026-10-10T21:40:00Z' },
        ],
      }),
    });
    renderApp('/admin/orders/DT-261010-D005');
    const ticket = await screen.findByTestId('order-ticket');
    expect(ticket).toHaveClass('hidden', 'print:block');
    expect(within(ticket).getByText('DT-261010-D005')).toBeInTheDocument();
    expect(within(ticket).getByText(/Gate code 0000/)).toBeInTheDocument();
    expect(within(ticket).queryByText(/SECRET INTERNAL/)).not.toBeInTheDocument();
  });
});

describe('orders table', () => {
  it('sends filters, search and sorting as API params and keeps them in the URL', async () => {
    const { requests } = mockAdminOps();
    const { router } = renderApp('/admin/orders?view=table');
    await screen.findByText('DT-261010-D006');

    await userEvent.type(screen.getByRole('searchbox'), 'Lucía');
    await waitFor(() => {
      const q = [...requests].reverse().find((r) => r.url.pathname.endsWith('/admin/orders/'))!.url
        .searchParams;
      expect(q.get('q')).toBe('Lucía');
    });
    expect(router.state.location.search).toContain('q=Luc');

    await userEvent.click(screen.getByRole('button', { name: /Status filter/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Preparing' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Confirmed' }));
    await waitFor(() => {
      const q = [...requests].reverse().find((r) => r.url.pathname.endsWith('/admin/orders/'))!.url
        .searchParams;
      expect(q.getAll('status').join(',')).toBe('PREPARING,CONFIRMED');
    });

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /Total/ }));
    await waitFor(() => {
      const q = [...requests].reverse().find((r) => r.url.pathname.endsWith('/admin/orders/'))!.url
        .searchParams;
      expect(q.get('ordering')).toBe('total');
    });
  });

  it('applies the stuck toggle from the URL (as linked from the overview)', async () => {
    const { requests } = mockAdminOps();
    renderApp('/admin/orders?view=table&stuck=true');
    await screen.findByText('DT-261010-D006');
    const q = requests.find((r) => r.url.pathname.endsWith('/admin/orders/'))!.url.searchParams;
    expect(q.get('stuck')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Stuck only' })).toBeChecked();
  });

  it('shows the needs-attention reason and icon+label status badges', async () => {
    mockAdminOps();
    renderApp('/admin/orders?view=table');
    expect(
      await screen.findByText('Confirmed 25 min ago, still not being prepared.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });

  it('turns into stacked cards on a narrow screen', async () => {
    window.innerWidth = 390;
    mockAdminOps();
    renderApp('/admin/orders?view=table');
    await screen.findByText('DT-261010-D006');
    const list = screen.getByRole('list', { name: 'Orders' });
    expect(within(list).getAllByRole('listitem').length).toBe(2);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an empty state with a way out when filters match nothing', async () => {
    mockAdminOps({ orders: [] });
    renderApp('/admin/orders?view=table&q=zzz');
    expect(await screen.findByText('No orders match these filters')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Clear filters/ }).length).toBeGreaterThan(0);
  });
});

describe('orders queue board', () => {
  it('shows a column per active status with counts, oldest age and the orders in it', async () => {
    mockAdminOps();
    renderApp('/admin/orders');
    const confirmed = await screen.findByRole('region', { name: 'Confirmed' }).catch(() => null);
    const column = confirmed ?? (await screen.findByText('Confirmed')).closest('section')!;
    expect(within(column as HTMLElement).getByText('Oldest 25 min')).toBeInTheDocument();
    expect(within(column as HTMLElement).getByText('1 late')).toBeInTheDocument();
    expect(
      await screen.findByText('Live · refreshes every 15 s', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /DT-261010-D00/ }).length).toBeGreaterThan(0);
  });
});
