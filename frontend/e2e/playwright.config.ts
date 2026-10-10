import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a live stack: Django on :8000 and the Vite dev server (started here) on :5173.
 *   cd backend && ../.venv/bin/python manage.py runserver 8000     # seeded database
 *   cd frontend && npm run test:e2e
 * Override the target with E2E_BASE_URL (e.g. a built `vite preview` or the nginx container).
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH; set E2E_CHROMIUM_PATH to use a specific binary.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.E2E_CHROMIUM_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_PATH }
          : {},
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        launchOptions: process.env.E2E_CHROMIUM_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 5173 --host 127.0.0.1',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
