import { expect, test } from '@playwright/test';
import {
  addLatteToCart,
  collectErrors,
  completePickupDetails,
  placeOrder,
  registerAtCheckout,
  uniqueEmail,
} from './helpers-commerce';

/**
 * The acceptance journey: a brand-new customer browses, customises, registers at checkout, pays with the
 * sandbox provider and finds the order in their history.
 * Run: E2E_BASE_URL=http://127.0.0.1:5175 npx playwright test -c e2e/playwright.config.ts purchase.spec.ts
 */
test('new customer: customise → cart → register → pickup checkout → sandbox pay → confirmation → order history', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const checkoutBodies: Array<Record<string, unknown>> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/checkout/')) {
      checkoutBodies.push(r.postDataJSON() as Record<string, unknown>);
    }
  });

  await addLatteToCart(page);

  // Cart page: lines, server-priced summary, guest prompt.
  await page.goto('/cart');
  await expect(page.getByRole('heading', { level: 1, name: 'Your cart' })).toBeVisible();
  const line = page.getByTestId('cart-line');
  await expect(line).toContainText('Latte');
  await expect(line).toContainText('Large');
  await expect(page.getByTestId('guest-prompt')).toContainText('Your cart is saved');
  await expect(page.getByTestId('price-breakdown')).toContainText('Estimated total');
  await page.getByRole('link', { name: 'Checkout' }).click();

  // Register inline; the cart survives.
  const email = uniqueEmail('buyer');
  await expect(page.getByRole('heading', { name: 'Sign in to place your order' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Your cart' })).toContainText('Latte');
  await registerAtCheckout(page, email);

  // Pickup, sandbox payment, terms.
  await completePickupDetails(page);
  await placeOrder(page);

  // Sandbox payment page: loudly fake.
  await expect(page).toHaveURL(/\/pay\/demo\/demo_/, { timeout: 20_000 });
  await expect(page.getByRole('note')).toContainText('Sandbox payment — no real money moves');
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();

  // Confirmation verifies with the provider and shows PAID.
  await expect(page).toHaveURL(/\/orders\/[^/]+\/confirmation/);
  await expect(page.getByTestId('confirmation-title')).toContainText('Your order is in');
  const number = (await page.getByTestId('order-number').textContent())?.trim() ?? '';
  expect(number).toMatch(/^[A-Z]+-\d{6}-/);
  await expect(page.getByText('Paid').first()).toBeVisible();
  await expect(page.getByText(/Sandbox payment — no real money moved/)).toBeVisible();

  // Tracking page.
  await page.getByRole('link', { name: 'Track your order' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
  await expect(page.getByRole('list', { name: 'Order progress' })).toBeVisible();

  // Visible in the account's order history.
  await page.goto('/account/orders');
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  const card = page.getByTestId('order-card').filter({ hasText: number });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Latte');

  // The order payload carried choices and the displayed total, never prices.
  expect(checkoutBodies).toHaveLength(1);
  const body = checkoutBodies[0] ?? {};
  expect(
    Object.keys(body).filter((k) => /price|amount|subtotal|fee|tax|discount/i.test(k)),
  ).toEqual([]);
  expect(body).toMatchObject({ order_type: 'PICKUP', payment_method: 'demo', accept_terms: true });
  expect(typeof body.expected_total).toBe('string');
  expect(errors).toEqual([]);
});
