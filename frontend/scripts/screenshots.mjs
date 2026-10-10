/**
 * Visual QA helper: captures full-page screenshots at desktop/tablet/mobile widths.
 *   BASE_URL=http://127.0.0.1:5173 node scripts/screenshots.mjs [outDir] [route ...]
 * Defaults to the foundation pages (/, /login, /register). Uses the preinstalled Chromium.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const [outDir = '../docs/screenshots/foundation', ...routes] = process.argv.slice(2);
const targets = routes.length ? routes : ['/', '/login', '/register'];
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
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${size.name}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${size.name}] pageerror ${e.message}`));
  for (const route of targets) {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    // Scroll through the page so lazy images load and scroll-reveal sections appear.
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.7;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1500);
    const slug = route === '/' ? 'home' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    await page.screenshot({ path: path.join(outDir, `${slug}-${size.name}.png`), fullPage: true });
  }
  await context.close();
}
await browser.close();
if (errors.length) {
  console.error('Console/page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
