/**
 * Visual QA for the catalogue/stock half of the admin dashboard (signed in as a staff demo account).
 *   BASE_URL=http://127.0.0.1:5177 node scripts/admin-catalog-screenshots.mjs [outDir]
 * Captures desktop 1440 / tablet 820 / mobile 390 for each route. Uses the preinstalled Chromium.
 * Demo credentials are development-only (docs/seed-data.md).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const email = process.env.STAFF_EMAIL ?? 'admin@lantern.example';
const password = process.env.DEMO_PASSWORD ?? 'Lantern-demo-2026!';
const outDir = process.argv[2] ?? '../docs/screenshots/admin-catalog';
const routes = [
  '/admin/products',
  '/admin/products/6',
  '/admin/products/new',
  '/admin/categories',
  '/admin/options?group=2',
  '/admin/collections?collection=1',
  '/admin/reviews',
  '/admin/inventory',
  '/admin/inventory?tab=movements',
  '/admin/inventory?tab=availability&branch=3',
  '/admin/branches?branch=1',
];
const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'mobile', width: 390, height: 844 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const errors = [];
for (const size of sizes) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
  });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${size.name}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${size.name}] pageerror ${e.message}`));
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.locator('main input[name=email]').first().fill(email);
  await page.locator('main input[name=password]').first().fill(password);
  await page.locator('main form button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const slug = route
      .replace(/^\/admin\//, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/-$/, '');
    await page.screenshot({ path: path.join(outDir, `${slug}-${size.name}.png`), fullPage: true });
  }
  await context.close();
}
await browser.close();
if (errors.length) {
  console.error('Console/page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
