import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, resetTestWorld } from '@/test/utils';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { anonymousMe, customerMe, DEMO_PASSWORD, demoUser } from '@/mocks/fixtures';
import { resetSelectedBranchForTests } from '@/features/catalog/useSelectedBranch';
import { resetSelectionForTests } from './selection';
import { clearAttemptKey } from './idempotency';
import { commerceHandlers, createCommerceCtx, type CommerceCtx } from './testing/commerceMocks';

// Pages are lazy chunks: the first render of a cold test file can be slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let ctx: CommerceCtx;

function setup(over: Parameters<typeof createCommerceCtx>[0] = {}) {
  ctx = createCommerceCtx(over);
  server.use(...commerceHandlers(ctx));
  state.me = { ...customerMe, user: { ...demoUser, phone: '+1 555 010 0201' } };
}
const checkoutCalls = () => ctx.requests.filter((r) => r.path === 'checkout/');

beforeEach(() => {
  resetTestWorld();
  resetSelectedBranchForTests();
  resetSelectionForTests();
  clearAttemptKey();
  window.sessionStorage.clear();
});

async function ready() {
  // The steps and the first server-priced summary are on screen.
  await screen.findByRole('heading', { name: /Pickup or delivery/ }, { timeout: 5000 });
  await waitFor(() => expect(screen.getByRole('button', { name: /Place order/ })).toBeEnabled());
}
const acceptTerms = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('checkbox', { name: /I agree to the/ }));
const place = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /Place order/ }));

describe('checkout: placing the order', () => {
  it('sends choices and the displayed total, never prices, with an Idempotency-Key, then goes to the sandbox payment', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    expect(await screen.findByTestId('price-breakdown')).toHaveTextContent('$9.72');
    await acceptTerms(user);
    await place(user);

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Sandbox payment — no real money moves',
    );
    expect(
      await screen.findByRole('button', { name: 'Simulate successful payment' }),
    ).toBeInTheDocument();

    const [call] = checkoutCalls();
    expect(call).toBeDefined();
    const body = call?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      branch_id: 1,
      order_type: 'PICKUP',
      payment_method: 'demo',
      accept_terms: true,
      expected_total: '9.72',
    });
    // No money other than the total the customer saw (for the server to compare) ever leaves the browser.
    const priceKeys = Object.keys(body).filter((k) =>
      /price|amount|subtotal|fee|tax|discount/i.test(k),
    );
    expect(priceKeys).toEqual([]);
    expect(call?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the same Idempotency-Key when retrying after a dropped connection', async () => {
    setup({ checkoutFailures: [() => HttpResponse.error()] });
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await acceptTerms(user);
    await place(user);

    const alert = await screen.findByTestId('place-error');
    expect(alert).toHaveTextContent(/could not reach the server/i);
    expect(alert).toHaveTextContent(/never create two orders/i);
    await place(user);
    await screen.findByRole('button', { name: 'Simulate successful payment' });

    const calls = checkoutCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.get('Idempotency-Key')).toBe(calls[1]?.headers.get('Idempotency-Key'));
    expect(ctx.placed).toHaveLength(1);
  });

  it('starts the next order with a fresh key after a success', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await acceptTerms(user);
    await place(user);
    await screen.findByRole('button', { name: 'Simulate successful payment' });
    expect(window.sessionStorage.getItem('lantern.checkout.attempt')).toBeNull();
  });

  it('on 409 price_changed shows what changed and resubmits only after the customer accepts the new total', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    expect(await screen.findByTestId('price-breakdown')).toHaveTextContent('$9.72');
    await acceptTerms(user);
    ctx.priceFactor = 1.1; // the server's price moved after the customer looked
    await place(user);

    const dialog = await screen.findByRole('dialog', { name: 'Your total has changed' });
    expect(dialog).toHaveTextContent('$9.72'); // previous
    expect(dialog).toHaveTextContent('$10.69'); // new, from the server's fresh preview
    expect(ctx.placed).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: /Accept new total/ }));
    await screen.findByRole('button', { name: 'Simulate successful payment' });
    const calls = checkoutCalls();
    expect(calls).toHaveLength(2);
    expect((calls[1]?.body as { expected_total: string }).expected_total).toBe('10.69');
    expect(ctx.placed).toHaveLength(1);
  });

  it('lets the customer review instead of accepting a changed total', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await screen.findByTestId('price-breakdown');
    await acceptTerms(user);
    ctx.priceFactor = 1.1;
    await place(user);
    const dialog = await screen.findByRole('dialog', { name: 'Your total has changed' });
    await user.click(within(dialog).getByRole('button', { name: 'Review order' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ctx.placed).toHaveLength(0);
    // The summary now shows the new server total.
    expect(await screen.findByTestId('price-breakdown')).toHaveTextContent('$10.69');
  });

  it('maps server field errors onto the fields they belong to', async () => {
    setup({
      checkoutFailures: [
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_error',
                message: 'Please correct the highlighted fields.',
                fields: { phone: ['Enter a valid phone number.'], customer_notes: ['Too long.'] },
                request_id: 'r',
              },
            },
            { status: 400 },
          ),
      ],
    });
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await acceptTerms(user);
    await place(user);
    const phone = await screen.findByRole('textbox', { name: /Phone/ });
    await waitFor(() => expect(phone).toHaveAccessibleDescription(/Enter a valid phone number/));
    expect(screen.getByRole('textbox', { name: /Notes for the team/ })).toHaveAccessibleDescription(
      /Too long/,
    );
  });

  it('lists the items when stock has run out', async () => {
    setup({
      checkoutFailures: [
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'out_of_stock',
                message: 'Not enough stock for: Ethiopia Guji.',
                items: [{ product_id: 5, name: 'Ethiopia Guji', requested: 3, available: 1 }],
                request_id: 'r',
              },
            },
            { status: 409 },
          ),
      ],
    });
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await acceptTerms(user);
    await place(user);
    const alert = await screen.findByTestId('place-error');
    expect(alert).toHaveTextContent('Ethiopia Guji — only 1 left (you asked for 3)');
    expect(within(alert).getByRole('link', { name: 'Review your cart' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });

  it('shows a closed-branch error against the location step', async () => {
    setup({
      checkoutFailures: [
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'branch_closed',
                message: 'Old Town Roastery is closed right now.',
                request_id: 'r',
              },
            },
            { status: 409 },
          ),
      ],
    });
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await acceptTerms(user);
    await place(user);
    const step = (await screen.findByRole('heading', { name: /^Location/ })).closest('section');
    expect(step).toHaveTextContent('Old Town Roastery is closed right now.');
  });

  it('asks for the terms before sending anything', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await place(user);
    expect(
      await screen.findByText(/Please accept the Terms and Refund Policy/),
    ).toBeInTheDocument();
    expect(checkoutCalls()).toHaveLength(0);
  });

  it('sends cash orders straight to the confirmation page', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await user.click(await screen.findByRole('radio', { name: /Pay at pickup/ }));
    await acceptTerms(user);
    await place(user);
    expect(await screen.findByTestId('confirmation-title')).toHaveTextContent(
      /Your order is placed/,
    );
    expect(await screen.findByText(/pay when you collect it/i)).toBeInTheDocument();
  });
});

describe('checkout: fulfilment choices', () => {
  it('requires an address for delivery and sends address_id once one is chosen', async () => {
    setup({ addresses: [] });
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    await screen.findByRole('heading', { name: /^Delivery address/ });
    await acceptTerms(user);
    await place(user);
    expect(await screen.findAllByText('Choose a delivery address.')).not.toHaveLength(0);
    expect(checkoutCalls()).toHaveLength(0);
  });

  it('adds an address inline with a delivery zone, selects it and delivers to it', async () => {
    setup({ addresses: [] });
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    await user.click(await screen.findByRole('button', { name: /Add a new address/ }));
    const dialog = await screen.findByRole('dialog', { name: /Add a delivery address/ });
    await user.type(within(dialog).getByLabelText(/Street address/), '5 Test Road');
    await user.type(within(dialog).getByLabelText(/^City/), 'Harbour City');
    await user.click(within(dialog).getByRole('combobox', { name: /Delivery area/ }));
    await user.click(await screen.findByRole('option', { name: 'Old Town' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add address' }));

    const created = ctx.requests.find((r) => r.method === 'POST' && r.path === 'addresses/');
    await waitFor(() => expect(created).toBeDefined());
    expect(created?.body).toMatchObject({ line1: '5 Test Road', zone: 1 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await acceptTerms(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /Place order/ })).toBeEnabled());
    await place(user);
    await screen.findByRole('button', { name: 'Simulate successful payment' });
    expect(checkoutCalls()[0]?.body).toMatchObject({ order_type: 'DELIVERY', address_id: 10 });
    // delivery fee came from the server preview
    expect((checkoutCalls()[0]?.body as { expected_total: string }).expected_total).toBe('12.22');
  });

  it('shows below-minimum / unsupported-zone messages from the server and blocks placing the order', async () => {
    setup({
      blockers: [
        {
          code: 'below_delivery_minimum',
          message: 'The minimum order for delivery to Old Town is 10.00.',
          severity: 'error',
        },
      ],
    });
    renderApp('/checkout');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: /Pickup or delivery/ });
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    const step = (await screen.findByRole('heading', { name: /^Delivery address/ })).closest(
      'section',
    );
    expect(
      await within(step as HTMLElement).findByText(/minimum order for delivery to Old Town/),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Place order/ })).toBeDisabled());
  });

  it('sends the chosen time slot as requested_for', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole('radio', { name: /Schedule for later/ }));
    await user.click(await screen.findByRole('button', { name: '6:15 PM' }));
    expect(screen.getByRole('button', { name: '6:15 PM' })).toHaveAttribute('aria-pressed', 'true');
    await acceptTerms(user);
    await place(user);
    await screen.findByRole('button', { name: 'Simulate successful payment' });
    expect(checkoutCalls()[0]?.body).toMatchObject({ requested_for: '2026-10-10T18:15:00Z' });
  });

  it('forces a scheduled time when ASAP is unavailable', async () => {
    setup({ asapAvailable: false });
    renderApp('/checkout');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: /Pickup or delivery/ });
    expect(await screen.findByRole('radio', { name: /As soon as possible/ })).toBeDisabled();
    await user.click(await screen.findByRole('radio', { name: /Schedule for later/ }));
    expect(await screen.findByRole('button', { name: '6:00 PM' })).toBeInTheDocument();
  });
});

describe('checkout: coupon, payment, summary', () => {
  it('applies and removes a coupon through the server, with the discount shown in the live summary', async () => {
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await ready();
    await user.type(screen.getByRole('textbox', { name: 'Promo code' }), 'save10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const summary = await screen.findByRole('complementary', { name: 'Order summary' });
    await waitFor(() => expect(summary).toHaveTextContent('−$0.90'));
    await user.click(screen.getByRole('button', { name: /Remove promo code/ }));
    await waitFor(() => expect(summary).not.toHaveTextContent('−$0.90'));
  });

  it('labels sandbox and cash methods honestly', async () => {
    setup();
    renderApp('/checkout');
    await ready();
    const payment = (await screen.findByRole('heading', { name: /^Payment/ })).closest('section');
    expect(payment).toHaveTextContent('Sandbox — no real money moves');
    expect(payment).toHaveTextContent('Pay at pickup / on delivery');
    expect(payment).toHaveTextContent('Pay when you collect your order. Nothing is charged now.');
  });

  it('on a phone the summary is a bottom bar that expands to the full breakdown', async () => {
    window.innerWidth = 390;
    setup();
    renderApp('/checkout');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: /Pickup or delivery/ });
    const bar = await screen.findByTestId('mobile-summary-bar');
    await waitFor(() =>
      expect(within(bar).getByRole('button', { name: /Place order/ })).toBeEnabled(),
    );
    expect(bar).toHaveTextContent('$9.72');
    await user.click(within(bar).getByRole('button', { name: /view details/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Your order' });
    expect(within(sheet).getByTestId('price-breakdown')).toHaveTextContent('Sales tax');
  });
});

describe('checkout: signed-out visitors', () => {
  it('shows inline sign-in, keeps the cart, and continues to checkout after signing in', async () => {
    setup();
    state.me = anonymousMe;
    renderApp('/checkout');
    const user = userEvent.setup();
    expect(await screen.findByText('Sign in to place your order')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Your cart' })).toHaveTextContent(
      'Flat white',
    );
    const form = screen.getByRole('form', { name: 'Sign in' });
    await user.type(within(form).getByLabelText(/^Email/), demoUser.email);
    await user.type(within(form).getByLabelText(/^Password/), DEMO_PASSWORD);
    await user.click(within(form).getByRole('button', { name: /Sign in and continue/ }));
    expect(await screen.findByRole('heading', { name: /Pickup or delivery/ })).toBeInTheDocument();
  });
});
