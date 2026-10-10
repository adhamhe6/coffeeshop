import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, resetTestWorld } from '@/test/utils';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { customerMe } from '@/mocks/fixtures';
import { resetSelectedBranchForTests } from '@/features/catalog/useSelectedBranch';
import { resetSelectionForTests } from '@/features/checkout/selection';
import {
  cartItem,
  commerceHandlers,
  createCommerceCtx,
  type CommerceCtx,
} from '@/features/checkout/testing/commerceMocks';

// Pages are lazy chunks: the first render of a cold test file can be slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let ctx: CommerceCtx;

function setup(over: Parameters<typeof createCommerceCtx>[0] = {}, signedIn = true) {
  ctx = createCommerceCtx(over);
  server.use(...commerceHandlers(ctx));
  if (signedIn) state.me = customerMe;
}
const requests = (method: string, path: string | RegExp) =>
  ctx.requests.filter(
    (r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)),
  );

beforeEach(() => {
  resetTestWorld();
  resetSelectedBranchForTests();
  resetSelectionForTests();
  window.sessionStorage.clear();
});

describe('cart page', () => {
  it('shows each line with its options as chips, unit and line totals, and the server breakdown', async () => {
    setup();
    renderApp('/cart');
    const line = await screen.findByTestId('cart-line');
    expect(within(line).getByText('Flat white')).toBeInTheDocument();
    expect(within(line).getByText('Size:')).toBeInTheDocument();
    expect(within(line).getByText('Large')).toBeInTheDocument();
    expect(line).toHaveTextContent('$4.50 each');
    expect(within(line).getByText('$9.00')).toBeInTheDocument();
    const breakdown = await screen.findByTestId('price-breakdown');
    // 9.00 + 8% tax, calculated by the (fake) server, only displayed by the page
    expect(within(breakdown).getByText('$0.72')).toBeInTheDocument();
    expect(within(breakdown).getByText('$9.72')).toBeInTheDocument();
    expect(within(line).getByRole('link', { name: 'Edit Flat white' })).toHaveAttribute(
      'href',
      '/p/product-1?edit=1',
    );
  });

  it('debounces quantity changes into a single PATCH and shows the server line total afterwards', async () => {
    setup();
    renderApp('/cart');
    const user = userEvent.setup();
    const line = await screen.findByTestId('cart-line');
    const plus = within(line).getByRole('button', { name: /Increase quantity of Flat white/ });
    await user.click(plus);
    await user.click(plus);
    // The stepper answers instantly…
    expect(within(line).getByRole('textbox', { name: /Quantity of Flat white/ })).toHaveValue('4');
    expect(requests('PATCH', 'cart/items/1/')).toHaveLength(0);
    // …and one request is sent once the clicking stops.
    await waitFor(() => expect(requests('PATCH', 'cart/items/1/')).toHaveLength(1), {
      timeout: 3000,
    });
    expect(requests('PATCH', 'cart/items/1/')[0]?.body).toEqual({ quantity: 4 });
    expect(await within(line).findByText('$18.00')).toBeInTheDocument();
  });

  it('removes a line and shows the empty state with ways forward', async () => {
    setup();
    renderApp('/cart');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove Flat white' }));
    await waitFor(() => expect(requests('DELETE', 'cart/items/1/')).toHaveLength(1));
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the menu' })).toHaveAttribute('href', '/menu');
  });

  it('warns about a changed price and clears it with "Accept new prices"', async () => {
    setup({
      cart: [cartItem({ id: 1, price_changed: { was: '4.00', now: '4.50' } })],
    });
    renderApp('/cart');
    const user = userEvent.setup();
    const warning = await screen.findByText(/Price changed from/);
    expect(warning).toHaveTextContent('$4.00');
    expect(warning).toHaveTextContent('$4.50');
    await user.click(screen.getByRole('button', { name: 'Accept new prices' }));
    await waitFor(() => expect(requests('POST', 'cart/acknowledge-prices/')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/Price changed from/)).not.toBeInTheDocument());
  });

  it('flags unavailable items and blocks checkout until they are removed', async () => {
    setup({
      cart: [
        cartItem({
          id: 1,
          product: { id: 1, slug: 'x', name: 'Sold out beans', image: null, is_available: false },
          issues: [
            {
              code: 'sold_out',
              message: 'Sold out beans is sold out.',
              severity: 'error',
              item_id: 1,
            },
          ],
        }),
      ],
    });
    renderApp('/cart');
    const user = userEvent.setup();
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Sold out beans is sold out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Checkout' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Sold out beans' }));
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
  });

  it('invites guests to sign in without losing their cart', async () => {
    setup({}, false);
    renderApp('/cart');
    const prompt = await screen.findByTestId('guest-prompt');
    expect(within(prompt).getByText(/Your cart is saved/)).toBeInTheDocument();
    expect(within(prompt).getByRole('link', { name: /Sign in/ })).toHaveAttribute(
      'href',
      '/login?next=%2Fcheckout',
    );
    expect(screen.getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/checkout');
  });

  it('applies a promo code through the server and displays the previewed discount', async () => {
    setup();
    renderApp('/cart');
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Promo code' }), 'save10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByTestId('coupon-applied')).toHaveTextContent('SAVE10');
    expect(requests('POST', 'coupons/validate/')[0]?.body).toMatchObject({ code: 'SAVE10' });
    const breakdown = await screen.findByTestId('price-breakdown');
    await waitFor(() => expect(breakdown).toHaveTextContent('−$0.90'));
    const previews = requests('POST', 'cart/preview/');
    expect(previews[previews.length - 1]?.body).toMatchObject({ coupon_code: 'SAVE10' });

    await user.click(screen.getByRole('button', { name: /Remove promo code SAVE10/ }));
    expect(await screen.findByRole('textbox', { name: 'Promo code' })).toBeInTheDocument();
  });

  it('shows the server message for a rejected promo code and does not apply it', async () => {
    setup();
    renderApp('/cart');
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Promo code' }), 'nope');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('That promo code is not valid.')).toBeInTheDocument();
    expect(screen.queryByTestId('coupon-applied')).not.toBeInTheDocument();
  });
});
