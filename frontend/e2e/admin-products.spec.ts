import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/**
 * Catalogue editing end to end, against a live seeded stack (see playwright.config.ts):
 * product manager creates a product (category, image, option group, price), it appears on the storefront,
 * the price is edited and the storefront follows, then the test cleans up after itself.
 * Demo credentials are development-only (docs/seed-data.md).
 */
const PASSWORD = 'Lantern-demo-2026!';

test.skip(({ isMobile }) => isMobile, 'The editor flow is covered on the desktop project.');

// ── a generated PNG fixture (solid colour, valid CRCs) ───────────────────
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
function makePng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('main input[name=email]').first().fill(email);
  await page.locator('main input[name=password]').first().fill(PASSWORD);
  await page.locator('main form button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe('admin product editor', () => {
  test('create → image → option group → price → storefront → edit price → storefront → delete', async ({
    page,
    request,
  }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E Honey Cortado ${stamp}`;
    const sku = `E2E-${stamp}`.toUpperCase();
    const slug = `e2e-honey-cortado-${stamp}`;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await signIn(page, 'productmanager@lantern.example');

    // 1. new product
    await page.goto('/admin/products');
    await page.getByRole('link', { name: 'New product' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New product' })).toBeVisible();

    await page.getByLabel(/^Name/).fill(name);
    await expect(page.getByLabel(/^Slug/)).toHaveValue(slug); // auto-suggested from the name
    await page.getByLabel(/^SKU/).fill(sku);
    await page.getByRole('combobox', { name: /^Category/ }).click();
    await page.getByRole('option', { name: 'Espresso', exact: true }).click();
    await page.getByLabel('Short description').fill('A cortado sweetened with a spoon of honey.');

    // 2. price
    await page.getByLabel(/^Base price/).fill('4.20');

    // 3. image (generated PNG)
    await page
      .locator('#section-images input[type=file]')
      .first()
      .setInputFiles({
        name: 'cortado.png',
        mimeType: 'image/png',
        buffer: makePng(96, 96, [180, 96, 43]),
      });
    await expect(page.getByAltText('Main image preview')).toBeVisible();

    // 4. option group (Size)
    await page.getByRole('combobox', { name: 'Add an option group' }).click();
    await page.getByRole('option', { name: /Size \(espresso\)/ }).click();
    await expect(page.getByRole('list', { name: 'Attached option groups' })).toContainText(
      'Size (espresso)',
    );
    await expect(page.getByText('What customers will see')).toBeVisible();

    // 5. preview tab renders the unsaved product
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(
      page.getByTestId('product-preview').getByRole('heading', { name }).first(),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Edit' }).click();

    // 6. save
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page).toHaveURL(/\/admin\/products\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('All changes saved')).toBeVisible();
    const productId = Number(page.url().split('/').pop());

    // the main image was uploaded after creation
    await expect(
      page.locator('#section-images img[src^="/media/products/"]').first(),
    ).toBeVisible();

    // 7. storefront shows it (price from the API, image from /media)
    const storefront = await page.context().newPage();
    await storefront.goto(`/p/${slug}`);
    await expect(storefront.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(storefront.getByText('$4.20').first()).toBeVisible();
    await expect(storefront.locator('img[src^="/media/products/"]').first()).toBeVisible();
    await expect(storefront.getByText('Size').first()).toBeVisible();
    const publicApi = await request.get(`/api/v1/products/${slug}/`);
    expect(publicApi.ok()).toBeTruthy();
    expect(((await publicApi.json()) as { base_price: string }).base_price).toBe('4.20');

    // 8. edit the price: audited notice, then the storefront follows
    const price = page.getByLabel(/^Base price/);
    await price.fill('5.10');
    await expect(page.getByText(/recorded in the audit log/)).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`${name} was saved.`)).toBeVisible();
    await storefront.reload();
    await expect(storefront.getByText('$5.10').first()).toBeVisible();
    // the product's own buy box (not other cards, e.g. leftovers from earlier runs)
    await expect(
      storefront.getByRole('heading', { level: 1, name }).locator('xpath=..').getByText('$4.20'),
    ).toHaveCount(0);

    // 9. mark sold out → storefront reflects availability
    await page.getByRole('switch', { name: 'Sold out everywhere' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`${name} was saved.`).last()).toBeVisible();
    await storefront.reload();
    await expect(storefront.getByText(/sold out/i).first()).toBeVisible();

    // 10. clean up through the UI (never ordered, so deletion is allowed)
    await page.getByRole('button', { name: /Delete/ }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`Delete ${name}`) });
    await dialog.getByRole('button', { name: 'Delete product' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await storefront.reload();
    await expect(storefront.getByRole('heading', { level: 1, name })).toHaveCount(0);
    expect((await request.get(`/api/v1/products/${slug}/`)).status()).toBe(404);
    void productId;
    expect(errors).toEqual([]);
  });

  test('slug and SKU conflicts are shown on their fields', async ({ page }) => {
    await signIn(page, 'productmanager@lantern.example');
    await page.goto('/admin/products/new');
    await page.getByLabel(/^Name/).fill('Espresso');
    await page.getByLabel(/^SKU/).fill('LC-0101');
    await page.getByRole('combobox', { name: /^Category/ }).click();
    await page.getByRole('option', { name: 'Espresso', exact: true }).click();
    await page.getByLabel(/^Base price/).fill('3.00');
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page.getByText(/slug already exists/i)).toBeVisible();
    await expect(page.getByText(/sku already exists/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/new$/);
  });

  test('order managers can look at the catalogue but not change it', async ({ page }) => {
    await signIn(page, 'ordermanager@lantern.example');
    await page.goto('/admin/products');
    await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New product' })).toHaveCount(0);
    await expect(
      page.getByRole('switch', { name: 'Sold out: Espresso', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Reviews' })).toHaveCount(0); // no reviews.moderate
  });
});
