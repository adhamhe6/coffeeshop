import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Storefront catalogue journeys against the seeded demo database (`seed_demo`):
 * browse → customise → add to cart, filters in the URL, search, branch selection, favourites.
 * Run: E2E_BASE_URL=http://127.0.0.1:5174 npx playwright test -c e2e/playwright.config.ts catalog.spec.ts
 */

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test.describe('catalogue', () => {
  test('browse the menu, open a product, customise it and add it to the cart', async ({ page }) => {
    const errors = collectErrors(page);
    const cartPosts: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/v1/cart/items/'))
        cartPosts.push(r.postDataJSON());
    });

    await page.goto('/menu');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // category tab → category page
    await page
      .getByRole('navigation', { name: 'Menu categories' })
      .getByRole('link', { name: /^Milk Coffee/ })
      .click();
    await expect(page).toHaveURL(/\/menu\/milk-coffee$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Milk Coffee' })).toBeVisible();

    // product page
    await page.getByRole('main').getByRole('link', { name: 'Latte', exact: true }).first().click();
    await expect(page).toHaveURL(/\/p\/latte$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Latte' })).toBeVisible();

    // customise: required groups are preselected; pick Large + oat milk + an extra shot
    await expect(page.getByRole('radio', { name: 'Small' })).toBeChecked();
    await page.getByRole('radio', { name: /^Large/ }).click();
    await page.getByRole('radio', { name: /^Oat milk/ }).click();
    await page.getByRole('checkbox', { name: /Extra espresso shot/ }).click();

    // server-computed breakdown: 4.50 + 1.20 + 0.60 + 0.90
    const breakdown = page.getByLabel('Price breakdown');
    await expect(breakdown).toContainText('$7.20');
    await expect(breakdown).toContainText('Oat milk');
    await page.getByRole('button', { name: 'Increase quantity of Latte' }).click();
    await expect(breakdown).toContainText('$14.40');

    await page.getByRole('button', { name: /^Add to cart/ }).click();
    await expect(page.getByText(/Added 2 × Latte to your cart/).first()).toBeVisible();
    // desktop: the cart panel slides in; phones keep the page and show the count on the header link
    const panel = page.getByRole('dialog', { name: 'Your cart' });
    const phoneCart = page.getByRole('link', { name: 'Cart, 2 items' });
    await expect(panel.or(phoneCart)).toBeVisible();
    if (await panel.isVisible()) {
      await expect(panel.getByRole('link', { name: 'Latte', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(page.getByLabel('Cart, 2 items')).toBeVisible();

    // the request carried the configuration only: never a price
    expect(cartPosts).toHaveLength(1);
    const body = cartPosts[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['option_ids', 'product_id', 'quantity']);
    expect(body.quantity).toBe(2);
    expect((body.option_ids as number[]).length).toBe(5);
    expect(errors).toEqual([]);
  });

  test('filters live in the URL and survive reload; chips remove them', async ({ page }) => {
    await page.goto('/menu?type=BEANS&ordering=price');
    await expect(page.getByRole('button', { name: 'Remove filter: Coffee beans' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toContainText('low to high');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove filter: Coffee beans' })).toBeVisible();

    const aside = page.getByRole('complementary', { name: 'Filters' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await aside.getByRole('button', { name: /single origin/i }).click();
    await expect(page).toHaveURL(/tag=single-origin/);
    await page.getByRole('button', { name: 'Clear all' }).first().click();
    await expect(page).toHaveURL(/\/menu\?ordering=price$/);
  });

  test('search tolerates typos and explains an empty result', async ({ page }) => {
    await page.goto('/search?q=latee');
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Latte', exact: true }),
    ).toBeVisible();

    await page.goto('/search?q=zzzzqq');
    await expect(page.getByRole('heading', { name: 'No results for “zzzzqq”' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Popular categories' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page).toHaveURL(/\/search$/);
  });

  test('choosing a branch makes availability branch-aware', async ({ page, isMobile }) => {
    test.skip(
      Boolean(isMobile),
      'header control is desktop-only; the mobile bar is covered in unit tests',
    );
    await page.goto('/menu?bestseller=true');
    await page
      .getByRole('button', { name: /Change branch/ })
      .first()
      .click();
    await page.getByRole('radio', { name: /Airport Kiosk/ }).click();
    // Airport Kiosk has no delivery and a reduced menu
    await expect(page.getByRole('radio', { name: 'Delivery', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: /Ordering Airport Kiosk, pickup/ }).first(),
    ).toBeVisible();
    await page.goto('/menu/filter-cold-brew');
    await expect(page.getByText('Unavailable at Airport Kiosk').first()).toBeVisible();
    // the selection persists across reloads
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Ordering Airport Kiosk/ }).first(),
    ).toBeVisible();
  });

  test('anonymous favourites are kept locally and listed on /favorites', async ({ page }) => {
    await page.goto('/menu/espresso');
    await page.getByRole('button', { name: /^Save Espresso to favorites/ }).click();
    await expect(
      page.getByRole('button', { name: /^Remove Espresso from favorites/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/favorites');
    await expect(page.getByRole('heading', { level: 1, name: 'Favorites' })).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Espresso', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Saved on this device only.')).toBeVisible();
  });

  test('locations list branches and set the branch for ordering', async ({ page }) => {
    await page.goto('/locations');
    await expect(page.getByRole('heading', { level: 1, name: /Locations/ })).toBeVisible();
    await page.getByRole('button', { name: /Order pickup here at Riverside/ }).click();
    await expect(page).toHaveURL(/\/menu$/);
  });

  test('contact page shows real contact links and no form', async ({ page }) => {
    await page.goto('/contact');
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: /@lantern\.example$/ })
        .first(),
    ).toHaveAttribute('href', /^mailto:/);
    await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);
  });
});
