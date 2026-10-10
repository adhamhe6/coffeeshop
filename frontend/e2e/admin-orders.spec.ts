import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Admin processes a customer's order through every status; the customer's tracking page follows.
 * Needs the seeded stack (customer@lantern.example, ordermanager@lantern.example) behind E2E_BASE_URL.
 * The customer order is created through the API (cash, pickup), exactly what the storefront checkout posts.
 */
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Lantern-demo-2026!';
const BRANCH_ID = Number(process.env.E2E_BRANCH_ID ?? 1);
const CROISSANT_PRODUCT_ID = Number(process.env.E2E_PRODUCT_ID ?? 39); // Butter Croissant: no required options

async function csrf(request: APIRequestContext): Promise<string> {
  await request.get('/api/v1/auth/csrf/');
  const state = await request.storageState();
  const token = state.cookies.find((c) => c.name === 'lantern_csrftoken')?.value;
  if (!token) throw new Error('no CSRF cookie');
  return token;
}

async function apiLogin(request: APIRequestContext, email: string) {
  const token = await csrf(request);
  const res = await request.post('/api/v1/auth/login/', {
    data: { email, password: PASSWORD },
    headers: { 'X-CSRFToken': token },
  });
  expect(res.ok(), `login ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function placeCashPickupOrder(request: APIRequestContext): Promise<string> {
  await apiLogin(request, 'customer@lantern.example');
  const token = await csrf(request);
  const headers = { 'X-CSRFToken': token };
  await request.delete('/api/v1/cart/', { headers });
  const add = await request.post('/api/v1/cart/items/', {
    data: { product_id: CROISSANT_PRODUCT_ID, quantity: 1, option_ids: [], note: 'e2e order' },
    headers,
  });
  expect(add.ok(), await add.text()).toBeTruthy();
  const res = await request.post('/api/v1/checkout/', {
    data: {
      branch_id: BRANCH_ID,
      order_type: 'PICKUP',
      payment_method: 'cash',
      accept_terms: true,
      customer_notes: 'Placed by the Playwright admin-orders spec',
    },
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as { order: { number: string } };
  return body.order.number;
}

async function uiLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('main input[name="email"]').fill(email);
  await page.locator('main input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function newSignedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await uiLogin(page, email);
  return { context, page };
}

test.describe('admin processes an order end to end', () => {
  test.describe.configure({ mode: 'serial' });

  test('confirm → prepare → ready → complete, with the customer following along', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const customerApi = await playwright.request.newContext({ baseURL });
    const number = await placeCashPickupOrder(customerApi);

    const admin = await newSignedInPage(browser, 'ordermanager@lantern.example');
    const customer = await newSignedInPage(browser, 'customer@lantern.example');
    const errors: string[] = [];
    for (const p of [admin.page, customer.page]) {
      p.on('pageerror', (e) => errors.push(e.message));
    }

    // The new order is on the live board in the "Order placed" column.
    await admin.page.goto('/admin/orders');
    const placed = admin.page.getByRole('region', { name: 'Order placed' }).or(
      admin.page.locator('section', {
        has: admin.page.getByRole('heading', { name: 'Order placed' }),
      }),
    );
    await expect(placed.getByRole('link', { name: new RegExp(number) })).toBeVisible();

    await admin.page.getByRole('link', { name: new RegExp(number) }).click();
    await expect(
      admin.page.getByRole('heading', { level: 1, name: new RegExp(number) }),
    ).toBeVisible();

    const customerStatus = async (status: string) => {
      await customer.page.goto(`/orders/${number}`);
      await expect(customer.page.locator(`[data-status="${status}"]`).first()).toBeVisible();
    };
    await customerStatus('PENDING');

    const step = async (button: string, status: string) => {
      await admin.page
        .getByRole('group', { name: 'Order actions' })
        .getByRole('button', { name: button })
        .click();
      await expect(
        admin.page.getByRole('heading', { level: 1 }).locator(`[data-status="${status}"]`),
      ).toBeVisible();
      await customerStatus(status);
    };

    await step('Confirm order', 'CONFIRMED');
    await step('Start preparing', 'PREPARING');
    await step('Mark ready for pickup', 'READY_FOR_PICKUP');

    // Cash is recorded explicitly, after a confirmation dialog.
    await admin.page.getByRole('button', { name: 'Mark cash collected' }).click();
    const dialog = admin.page.getByRole('dialog', { name: 'Mark cash as collected?' });
    await dialog.getByRole('button', { name: 'Yes, cash collected' }).click();
    await expect(dialog).toBeHidden();
    await expect(admin.page.getByText('Paid', { exact: true }).first()).toBeVisible();

    await step('Mark completed', 'COMPLETED');
    await expect(
      admin.page.getByRole('group', { name: 'Order actions' }).getByText(/This order is final/),
    ).toBeVisible();

    // History lists every step with the staff member who did it.
    const history = admin.page
      .getByRole('heading', { name: 'Status history' })
      .locator('xpath=ancestor::section[1]');
    await expect(history.getByText('Marcus Webb').first()).toBeVisible();

    expect(errors).toEqual([]);
    await admin.context.close();
    await customer.context.close();
    await customerApi.dispose();
  });
});
