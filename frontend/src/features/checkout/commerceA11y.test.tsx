import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { expectNoA11yViolations, renderApp, resetTestWorld } from '@/test/utils';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { customerMe } from '@/mocks/fixtures';
import { resetSelectedBranchForTests } from '@/features/catalog/useSelectedBranch';
import { resetSelectionForTests } from './selection';
import { commerceHandlers, createCommerceCtx, makeOrder } from './testing/commerceMocks';

// Pages are lazy chunks: the first render of a cold test file can be slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  resetTestWorld();
  resetSelectedBranchForTests();
  resetSelectionForTests();
  const ctx = createCommerceCtx();
  ctx.orders['OT-1'] = makeOrder({ number: 'OT-1', status: 'PREPARING' });
  ctx.demoPayments.demo_a = { order: 'OT-1', status: 'REQUIRES_ACTION' };
  ctx.notifications = [
    {
      id: 1,
      kind: 'x',
      title: 'Hello',
      body: 'b',
      is_read: false,
      order_number: 'OT-1',
      created_at: '2026-10-10T10:00:00Z',
    },
  ];
  server.use(...commerceHandlers(ctx));
  state.me = customerMe;
});

describe('accessibility (axe)', () => {
  it.each([
    ['/cart', /Your cart/],
    ['/checkout', /Pickup or delivery/],
    ['/orders/OT-1', /Progress/],
    ['/pay/demo/demo_a', /Pay for order/],
    ['/account', /Your details/],
    ['/account/addresses', /Addresses/],
    ['/account/orders', /Orders/],
    ['/account/notifications', /Notifications/],
  ])('%s has no violations', async (route, heading) => {
    const { container } = renderApp(route);
    await screen.findByRole('heading', { name: heading }, { timeout: 5000 });
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: /loading/i })).not.toBeInTheDocument(),
    );
    await new Promise((r) => setTimeout(r, 300));
    await expectNoA11yViolations(container);
  });
});
