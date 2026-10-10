/**
 * Release screenshots of the real running product (storefront + signed-in customer + staff roles).
 *   BASE_URL=http://127.0.0.1:5173 node scripts/release-screenshots.mjs [outDir]
 * Needs the stack running with `manage.py seed_demo` data. Demo credentials are development-only (docs/seed-data.md).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const outDir = process.argv[2] ?? '../docs/screenshots/release';
const password = process.env.DEMO_PASSWORD ?? 'Lantern-demo-2026!';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const errors = [];

async function session(size, email) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  if (email) {
    await page.goto(base + '/login');
    await page
      .getByRole('main')
      .getByLabel(/^Email/)
      .fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  return { context, page };
}

async function shot(page, name, route, { wait } = {}) {
  if (route) await page.goto(base + route, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.7;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  if (wait) await wait(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

// Storefront (anonymous + customer)
for (const [label, size] of [
  ['desktop', desktop],
  ['mobile', mobile],
]) {
  const { context, page } = await session(size, null);
  await shot(page, `store-home-${label}`, '/');
  await shot(page, `store-menu-${label}`, '/menu');
  await shot(page, `store-product-${label}`, '/p/latte');
  await shot(page, `store-locations-${label}`, '/locations');
  await context.close();
}
{
  const { context, page } = await session(desktop, 'customer@lantern.example');
  await shot(page, 'customer-orders-desktop', '/account/orders');
  await shot(page, 'customer-favorites-desktop', '/favorites');
  await context.close();
}
// Staff roles (desktop)
const staff = [
  [
    'admin',
    'admin@lantern.example',
    [
      '/admin',
      '/admin/orders',
      '/admin/products',
      '/admin/inventory',
      '/admin/reports',
      '/admin/payments',
      '/admin/coupons',
      '/admin/staff',
      '/admin/audit-log',
    ],
  ],
  ['branchmanager', 'branchmanager.downtown@lantern.example', ['/admin']],
];
for (const [who, email, routes] of staff) {
  const { context, page } = await session(desktop, email);
  for (const r of routes)
    await shot(
      page,
      `admin-${who}-${r.replace(/\//g, '-').replace(/^-admin-?/, '') || 'overview'}`,
      r,
    );
  await context.close();
}
{
  const { context, page } = await session(mobile, 'ordermanager@lantern.example');
  await shot(page, 'admin-orders-mobile', '/admin/orders');
  await context.close();
}
await browser.close();
if (errors.length) {
  console.error('Console/page errors:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
}
