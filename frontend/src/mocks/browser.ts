import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * Browser MSW worker for `VITE_MOCK_API=1 npm run dev`. Never imported by production code paths:
 * main.tsx loads this module behind a build-time constant that Vite tree-shakes out of production builds.
 */
export async function startMocks() {
  const worker = setupWorker(...handlers);
  await worker.start({
    onUnhandledRequest(request, print) {
      const { pathname } = new URL(request.url);
      // Assets, HMR and fonts are not API calls; only warn about unhandled API requests.
      if (pathname.startsWith('/api/')) print.warning();
    },
    serviceWorker: { url: '/mockServiceWorker.js' },
    quiet: true,
  });
}
