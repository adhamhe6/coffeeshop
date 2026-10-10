import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import '@/index.css';
import { AppProviders } from '@/app/providers';
import { createQueryClient } from '@/app/queryClient';
import { createAppRouter } from '@/app/router';

async function enableMocking() {
  // `VITE_MOCK_API` is a build-time constant: in production builds this branch (and the mocks) is removed.
  if (import.meta.env.VITE_MOCK_API === '1') {
    const { startMocks } = await import('@/mocks/browser');
    await startMocks();
  }
}

const queryClient = createQueryClient();
const router = createAppRouter();

void enableMocking().then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <AppProviders client={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
});
