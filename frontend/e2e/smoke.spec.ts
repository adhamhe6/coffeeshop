import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** Console noise that is not an application error (browser extensions, favicon probes). */
const IGNORED = [/favicon/i];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // ERR_ABORTED = the app cancelled a query (navigation / StrictMode remount); not a failure.
    const reason = r.failure()?.errorText ?? '';
    if (!r.url().includes('favicon') && !reason.includes('ERR_ABORTED'))
      errors.push(`requestfailed: ${r.url()} ${reason}`);
  });
  return errors;
}

test.describe('storefront smoke', () => {
  test('home loads with no console errors and the key landmarks', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .or(page.getByRole('button', { name: 'Open menu' })),
    ).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('makes no requests to third-party origins (self-hosted fonts, no CDN)', async ({
    page,
    baseURL,
  }) => {
    const foreign: string[] = [];
    const origin = new URL(baseURL ?? 'http://127.0.0.1:5173').origin;
    page.on('request', (r) => {
      const url = r.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (new URL(url).origin !== origin) foreign.push(url);
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(foreign).toEqual([]);
  });

  test('login and register pages render their forms', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('main').getByLabel(/^Email/)).toBeVisible();
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('unknown routes show the 404 page', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { name: /could not find that page/i })).toBeVisible();
  });

  test('keyboard: skip link reaches main content', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});
