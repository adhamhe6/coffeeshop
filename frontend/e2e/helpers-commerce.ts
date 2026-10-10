import { expect, type ConsoleMessage, type Page } from '@playwright/test';

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    // A deliberate 4xx (e.g. a declined sandbox payment or a replayed completion) logs a resource error.
    if (m.type() === 'error' && !/favicon|status of 40[0-9]/i.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

export const uniqueEmail = (prefix: string) =>
  `${prefix}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@lantern.example`;

export const PASSWORD = 'Brew-Test-2026-xyz';

/** Product page → Large Latte → Add to cart. Works on desktop (cart panel) and phone (header count). */
export async function addLatteToCart(page: Page) {
  await page.goto('/p/latte');
  await expect(page.getByRole('heading', { level: 1, name: 'Latte' })).toBeVisible();
  await page.getByRole('radio', { name: /^Large/ }).click();
  const added = page.waitForResponse(
    (r) => r.url().includes('/api/v1/cart/items/') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Add to cart/ }).click();
  expect((await added).ok()).toBe(true);
  const panel = page.getByRole('dialog', { name: 'Your cart' });
  if (await panel.isVisible()) await page.keyboard.press('Escape');
}

/** Register inline on the checkout page (guests keep their cart). */
export async function registerAtCheckout(page: Page, email: string) {
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Sign in to place your order' })).toBeVisible();
  await page.getByRole('tab', { name: 'Create account' }).click();
  const form = page.getByRole('form', { name: 'Create account' });
  await form.getByLabel(/^First name/).fill('Ellis');
  await form.getByLabel(/^Last name/).fill('Tester');
  await form.getByLabel(/^Email/).fill(email);
  await form.getByLabel(/^Password/).fill(PASSWORD);
  await form.getByRole('button', { name: /Create account and continue/ }).click();
  await expect(page.getByRole('heading', { name: /^Pickup or delivery/ })).toBeVisible();
}

/** Choose pickup, make sure a time is set (ASAP, or the first slot when the branch is closed), accept terms. */
export async function completePickupDetails(page: Page) {
  await page.getByRole('radio', { name: /^Pickup/ }).click();
  const asap = page.getByRole('radio', { name: /As soon as possible/ });
  await expect(asap).toBeVisible();
  if (await asap.isDisabled()) {
    await page.getByRole('radio', { name: /Schedule for later/ }).click();
    await page.getByRole('tab', { name: 'Tomorrow' }).click();
    await page
      .getByRole('group', { name: /^Times on/ })
      .getByRole('button')
      .first()
      .click();
  }
  await page.getByRole('radio', { name: /Sandbox payment/ }).click();
  await page.getByRole('checkbox', { name: /I agree to the/ }).check();
}

export async function placeOrder(page: Page) {
  // Desktop shows one summary column, phones a bottom bar: exactly one button matches.
  const button = page.getByRole('button', { name: /^Place order/ });
  await expect(button).toBeEnabled();
  await button.click();
}
