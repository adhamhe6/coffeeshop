import { expect, test, type Page } from '@playwright/test';

/**
 * Admin "people, marketing & configuration" flows against the REAL backend (seeded demo data):
 *   1. admin creates a coupon in the UI → it is applied for a customer through the real checkout API
 *   2. admin edits a homepage content block → the storefront homepage shows it
 *   3. a marketing manager cannot reach the staff page
 * Demo accounts and password come from docs/seed-data.md (development only).
 */
const PASSWORD = 'Lantern-demo-2026!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page
    .getByRole('main')
    .getByLabel(/^Email/)
    .fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe('admin business flows', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin creates a coupon that then applies for a customer at checkout', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page, 'admin@lantern.example');
    await page.goto('/admin/coupons/new');
    await page.getByLabel(/^Name/).fill('E2E ten percent');
    await page.getByRole('button', { name: 'Generate' }).click();
    const code = await page.getByLabel(/^Code/).inputValue();
    expect(code).toMatch(/^LANTERN-[A-Z0-9]{5}$/);
    await page.getByLabel(/^Percent off/).fill('10');
    // The plain-language summary updates live.
    await expect(page.getByTestId('coupon-summary')).toContainText(
      `Customers enter ${code}: 10% off the whole order`,
    );
    await page.getByRole('button', { name: 'Create coupon' }).click();
    await page.waitForURL('**/admin/coupons');
    await expect(page.getByRole('link', { name: code })).toBeVisible();

    // A customer (separate session) validates it against a real cart through the API.
    const customer = await browser.newContext({ baseURL });
    const api = customer.request;
    const csrf = async () => {
      await api.get('/api/v1/auth/csrf/');
      const cookies = await customer.cookies();
      return cookies.find((c) => c.name === 'lantern_csrftoken')?.value ?? '';
    };
    const login = await api.post('/api/v1/auth/login/', {
      data: { email: 'customer@lantern.example', password: PASSWORD },
      headers: { 'X-CSRFToken': await csrf() },
    });
    expect(login.ok()).toBeTruthy();
    // Find a product that can be added without choosing options (pastries / food).
    const list = await (await api.get('/api/v1/products/?type=FOOD&page_size=30')).json();
    let added = false;
    for (const product of list.results ?? list) {
      const add = await api.post('/api/v1/cart/items/', {
        data: { product_id: product.id, quantity: 1, option_ids: [], note: '' },
        headers: { 'X-CSRFToken': await csrf() },
      });
      if (add.ok()) {
        added = true;
        break;
      }
    }
    expect(added, 'a product without required options was added to the cart').toBe(true);
    const res = await api.post('/api/v1/coupons/validate/', {
      data: { code },
      headers: { 'X-CSRFToken': await csrf() },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(Number(body.discount)).toBeGreaterThan(0);
    await api.delete('/api/v1/cart/', { headers: { 'X-CSRFToken': await csrf() } });
    await customer.close();
  });

  test('admin edits a homepage block and the storefront shows it', async ({ page }) => {
    const headline = `E2E headline ${Date.now()}`;
    await signIn(page, 'marketing@lantern.example');
    await page.goto('/admin/content?tab=blocks');
    await page.getByRole('button', { name: /Our story/ }).click();
    const title = page.getByLabel('Title', { exact: true });
    await expect(title).toBeVisible();
    const original = await title.inputValue();
    await title.fill(headline);
    await page.getByRole('button', { name: 'Save block' }).click();
    await expect(page.getByText(/was saved/).first()).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: headline })).toBeVisible();

    // Put the original text back so the demo data stays tidy.
    await page.goto('/admin/content?tab=blocks');
    await page.getByRole('button', { name: /Our story/ }).click();
    await page.getByLabel('Title', { exact: true }).fill(original);
    await page.getByRole('button', { name: 'Save block' }).click();
    await expect(page.getByText(/was saved/).first()).toBeVisible();
  });

  test('a marketing manager cannot open the staff page', async ({ page }) => {
    await signIn(page, 'marketing@lantern.example');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    // On narrow screens the navigation lives in a drawer.
    const menuButton = page.getByRole('button', { name: 'Open admin menu' });
    if (await menuButton.isVisible()) await menuButton.click();
    await expect(page.getByRole('link', { name: 'Coupons', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0);
    if (await menuButton.isVisible()) await page.keyboard.press('Escape');
    await page.goto('/admin/staff');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
    // The API refuses too (defence in depth).
    const status = await page.evaluate(async () => (await fetch('/api/v1/admin/staff/')).status);
    expect(status).toBe(403);
  });
});
