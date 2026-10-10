import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, resetTestWorld } from '@/test/utils';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { customerMe } from '@/mocks/fixtures';
import { orderPolling } from '@/lib/api/orders';
import { resetSelectedBranchForTests } from '@/features/catalog/useSelectedBranch';
import { resetSelectionForTests } from '@/features/checkout/selection';
import {
  commerceHandlers,
  createCommerceCtx,
  makeOrder,
  type CommerceCtx,
} from '@/features/checkout/testing/commerceMocks';
import { syncTuning } from './usePaymentSync';

// Pages are lazy chunks: the first render of a cold test file can be slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let ctx: CommerceCtx;
const defaultSync = { ...syncTuning, delaysMs: [...syncTuning.delaysMs] };
const defaultPolling = { ...orderPolling };

function setup(orders: Array<ReturnType<typeof makeOrder>> = []) {
  ctx = createCommerceCtx();
  for (const o of orders) ctx.orders[o.number] = o;
  server.use(...commerceHandlers(ctx));
  state.me = customerMe;
}
const calls = (method: string, path: string | RegExp) =>
  ctx.requests.filter(
    (r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)),
  );

beforeEach(() => {
  resetTestWorld();
  resetSelectedBranchForTests();
  resetSelectionForTests();
});
afterEach(() => {
  Object.assign(syncTuning, defaultSync);
  Object.assign(orderPolling, defaultPolling);
});

const failedOrder = () =>
  makeOrder({
    number: 'OT-0001',
    payment_status: 'FAILED',
    payment: {
      status: 'FAILED',
      provider: 'demo',
      provider_label: 'Sandbox payment',
      is_sandbox: true,
      action: null,
      failure_message: 'The sandbox payment was declined (simulated).',
      can_retry: true,
    },
    actions: { can_cancel: true, can_pay: true, can_reorder: true, can_review: false },
  });

describe('sandbox payment page', () => {
  const open = (extra: Record<string, { order: string; status: string }> = {}) => {
    setup([failedOrder()]);
    ctx.demoPayments = { demo_abc: { order: 'OT-0001', status: 'REQUIRES_ACTION' }, ...extra };
  };

  it('is unmistakably a sandbox and shows the order and total', async () => {
    open();
    renderApp('/pay/demo/demo_abc');
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Sandbox payment — no real money moves',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OT-0001');
    expect(screen.getByText('$9.72')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate successful payment' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Simulate card declined' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel payment' })).toBeEnabled();
  });

  it('success posts the outcome, then lands on the confirmation page which verifies with the provider', async () => {
    open();
    ctx.syncSequence = ['PAID'];
    ctx.orders['OT-0001'] = makeOrder({ number: 'OT-0001', payment_status: 'PAID' });
    renderApp('/pay/demo/demo_abc');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Simulate successful payment' }));
    expect(await screen.findByTestId('confirmation-title')).toHaveTextContent(/Your order is in/);
    expect(calls('POST', 'payments/demo/demo_abc/complete/')[0]?.body).toEqual({
      outcome: 'success',
    });
    expect(calls('POST', 'orders/OT-0001/payment/sync/')).not.toHaveLength(0);
  });

  it('decline shows a clear notice on the order page and offers a retry that starts a new payment', async () => {
    open();
    renderApp('/pay/demo/demo_abc');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Simulate card declined' }));
    const notice = (await screen.findByText('Payment declined')).closest('[role="alert"]');
    expect(notice).toHaveTextContent('Nothing was charged');
    expect(calls('POST', 'payments/demo/demo_abc/complete/')[0]?.body).toEqual({
      outcome: 'decline',
    });

    await user.click(await screen.findByRole('button', { name: 'Try payment again' }));
    expect(calls('POST', 'orders/OT-0001/pay/')).toHaveLength(1);
    expect(
      await screen.findByRole('button', { name: 'Simulate successful payment' }),
    ).toBeInTheDocument();
  });

  it('cancel sends the cancel outcome and says so', async () => {
    open();
    renderApp('/pay/demo/demo_abc');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel payment' }));
    expect(await screen.findByText('Payment cancelled')).toBeInTheDocument();
    expect(calls('POST', 'payments/demo/demo_abc/complete/')[0]?.body).toEqual({
      outcome: 'cancel',
    });
  });

  it('a payment that was already settled cannot be completed again (no double charge)', async () => {
    open();
    renderApp('/pay/demo/demo_abc');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Simulate successful payment' });
    // Settled elsewhere (second tab / replayed request) while this page was open.
    const payment = ctx.demoPayments.demo_abc;
    if (payment) payment.status = 'PAID';
    await user.click(button);
    expect(await screen.findByText(/already paid/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Simulate successful payment' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your order' })).toHaveAttribute(
      'href',
      '/orders/OT-0001',
    );
  });

  it('shows a settled payment as unusable instead of offering the buttons', async () => {
    open({ demo_done: { order: 'OT-0001', status: 'PAID' } });
    renderApp('/pay/demo/demo_done');
    expect(await screen.findByText(/already paid/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Simulate successful payment' }),
    ).not.toBeInTheDocument();
  });

  it('handles an unknown or disabled payment session', async () => {
    open();
    renderApp('/pay/demo/nope');
    expect(
      await screen.findByRole('heading', { name: /payment session was not found/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your orders' })).toBeInTheDocument();
  });
});

describe('confirmation page', () => {
  const pending = () =>
    makeOrder({
      number: 'OT-0002',
      payment_status: 'REQUIRES_ACTION',
      payment: {
        status: 'REQUIRES_ACTION',
        provider: 'demo',
        provider_label: 'Sandbox payment',
        is_sandbox: true,
        action: null,
        failure_message: null,
        can_retry: true,
      },
      actions: { can_cancel: true, can_pay: true, can_reorder: true, can_review: false },
    });

  it('does not trust the redirect: it verifies, waits while the provider is pending, then shows PAID', async () => {
    syncTuning.delaysMs = [15];
    setup([pending()]);
    ctx.syncSequence = ['PENDING', 'PENDING', 'PAID'];
    renderApp('/orders/OT-0002/confirmation?payment=return');
    expect(await screen.findByText('Checking your payment…')).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
    expect(
      await screen.findByText(/Payment confirmed/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(calls('POST', 'orders/OT-0002/payment/sync/')).toHaveLength(3);
    expect(screen.getByTestId('order-number')).toHaveTextContent('OT-0002');
    expect(screen.getByText('What happens next')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track your order' })).toHaveAttribute(
      'href',
      '/orders/OT-0002',
    );
    expect(screen.getByRole('link', { name: /Continue shopping/ })).toHaveAttribute(
      'href',
      '/menu',
    );
  });

  it('says it is still waiting (and can check again) when the provider never confirms', async () => {
    syncTuning.delaysMs = [10];
    syncTuning.maxAttempts = 3;
    setup([pending()]);
    ctx.syncSequence = ['PENDING'];
    renderApp('/orders/OT-0002/confirmation?payment=return');
    const waiting = await screen.findByText('Still waiting for payment confirmation', undefined, {
      timeout: 3000,
    });
    expect(waiting).toBeInTheDocument();
    expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
    expect(calls('POST', 'orders/OT-0002/payment/sync/')).toHaveLength(3);

    ctx.syncSequence = ['PAID'];
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Payment confirmed/)).toBeInTheDocument();
  });

  it('reports a failed payment truthfully with a way to try again', async () => {
    setup([pending()]);
    ctx.syncSequence = ['FAILED'];
    renderApp('/orders/OT-0002/confirmation?payment=return');
    expect(await screen.findByText('Payment did not go through')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try payment again' })).toBeInTheDocument();
    expect(screen.queryByText(/Your order is in/)).not.toBeInTheDocument();
  });

  it('does not call the provider sync unless the customer is returning from one', async () => {
    setup([makeOrder({ number: 'OT-0003', payment_method: 'cash', payment_status: 'PENDING' })]);
    renderApp('/orders/OT-0003/confirmation');
    expect(await screen.findByTestId('confirmation-title')).toHaveTextContent(
      /Your order is placed/,
    );
    expect(calls('POST', /payment\/sync/)).toHaveLength(0);
  });

  it('handles an order that does not exist', async () => {
    setup();
    renderApp('/orders/NOPE/confirmation');
    expect(await screen.findByText('We could not find that order')).toBeInTheDocument();
  });
});

describe('order tracking', () => {
  const steps = () =>
    within(screen.getByRole('list', { name: 'Order progress' })).getAllByRole('listitem');

  it('renders a pickup timeline with the current step announced', async () => {
    setup([makeOrder({ number: 'OT-1', status: 'PREPARING' })]);
    renderApp('/orders/OT-1');
    await screen.findByRole('list', { name: 'Order progress' });
    expect(
      steps().map((s) =>
        s.textContent
          ?.replace(/\(.*?\)/g, '')
          .replace(/\d+:\d+ [AP]M|In progress/g, '')
          .trim(),
      ),
    ).toEqual(['Order placed', 'Confirmed', 'Preparing', 'Ready for pickup', 'Completed']);
    const current = steps().filter((s) => s.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Preparing (current step)');
    expect(screen.getByText('Current status: Preparing')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pickup and delivery details' }),
    ).toBeInTheDocument();
  });

  it('adapts to delivery: out-for-delivery step and the delivery address', async () => {
    setup([makeOrder({ number: 'OT-2', status: 'OUT_FOR_DELIVERY', order_type: 'DELIVERY' })]);
    renderApp('/orders/OT-2');
    await screen.findByRole('list', { name: 'Order progress' });
    expect(steps()[3]).toHaveTextContent('Out for delivery');
    expect(steps()[3]).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByText('Ready for pickup')).not.toBeInTheDocument();
    expect(screen.getByText('Delivering to')).toBeInTheDocument();
    expect(screen.getByText(/14 Sample Street/)).toBeInTheDocument();
    expect(screen.getByText(/Ring the top bell/)).toBeInTheDocument();
    expect(screen.getByText('Delivery fee')).toBeInTheDocument();
  });

  it('shows a cancelled order clearly, with the reason and no fake progress', async () => {
    setup([
      makeOrder({
        number: 'OT-3',
        status: 'CANCELLED',
        cancel_reason: 'Cancelled by customer',
        cancelled_at: '2026-10-10T10:05:00Z',
        payment_status: 'REFUNDED',
        refunded_total: '9.72',
        actions: { can_cancel: false, can_pay: false, can_reorder: true, can_review: false },
      }),
    ]);
    renderApp('/orders/OT-3');
    expect(await screen.findByText('This order was cancelled')).toBeInTheDocument();
    expect(screen.getByText('Cancelled by customer')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Order progress' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText(/Cancelled/)).toBeInTheDocument();
    expect(screen.getByTestId('order-totals')).toHaveTextContent('Refunded');
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('shows payment status with the sandbox flag, totals breakdown and items with options', async () => {
    setup([
      makeOrder({
        number: 'OT-4',
        status: 'CONFIRMED',
        discount_total: '1.00',
        coupon_code: 'SAVE10',
      }),
    ]);
    renderApp('/orders/OT-4');
    const payment = (await screen.findByRole('heading', { name: 'Payment' })).closest('section');
    expect(payment).toHaveTextContent('Paid');
    expect(payment).toHaveTextContent('Sandbox');
    const totals = screen.getByTestId('order-totals');
    expect(totals).toHaveTextContent('Discount (SAVE10)');
    expect(totals).toHaveTextContent('$9.72');
    expect(screen.getByRole('list', { name: 'Items in this order' })).toHaveTextContent(
      'Size:Large',
    );
  });

  it('cancel asks for confirmation, then cancels', async () => {
    setup([
      makeOrder({
        number: 'OT-5',
        status: 'PENDING',
        actions: { can_cancel: true, can_pay: false, can_reorder: true, can_review: false },
      }),
    ]);
    renderApp('/orders/OT-5');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this order?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep my order' }));
    expect(calls('POST', 'orders/OT-5/cancel/')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel order' }),
    );
    expect(await screen.findByText('This order was cancelled')).toBeInTheDocument();
    expect(calls('POST', 'orders/OT-5/cancel/')).toHaveLength(1);
  });

  it('reorder puts the items back in the cart and goes there', async () => {
    setup([makeOrder({ number: 'OT-6', status: 'COMPLETED' })]);
    renderApp('/orders/OT-6');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Order again' }));
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(calls('POST', 'orders/OT-6/reorder/')).toHaveLength(1);
  });

  it('offers a review link only when the server allows it', async () => {
    setup([
      makeOrder({
        number: 'OT-7',
        status: 'COMPLETED',
        actions: { can_cancel: false, can_pay: false, can_reorder: true, can_review: true },
      }),
    ]);
    renderApp('/orders/OT-7');
    expect(await screen.findByRole('link', { name: 'Leave a review' })).toHaveAttribute(
      'href',
      '/p/flat-white#reviews',
    );
  });

  it('refreshes itself while the order is moving, and stops once it is terminal', async () => {
    orderPolling.baseMs = 25;
    orderPolling.maxMs = 25;
    setup([
      makeOrder({ number: 'OT-8', status: 'PREPARING' }),
      makeOrder({ number: 'OT-9', status: 'COMPLETED' }),
    ]);
    const { unmount } = renderApp('/orders/OT-8');
    await screen.findByRole('list', { name: 'Order progress' });
    await waitFor(
      () => expect(calls('GET', 'orders/OT-8/').length).toBeGreaterThan(2) as unknown as void,
      { timeout: 2000 },
    );
    unmount();
    renderApp('/orders/OT-9');
    await screen.findByText('This order is complete.');
    const before = calls('GET', 'orders/OT-9/').length;
    await new Promise((r) => setTimeout(r, 200));
    expect(calls('GET', 'orders/OT-9/')).toHaveLength(before);
  });
});
