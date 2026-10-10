import type { ReactElement } from 'react';
import { render, screen, within, type RenderOptions } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import axe from 'axe-core';
import { AppProviders } from '@/app/providers';
import { createQueryClient } from '@/app/queryClient';
import { createTestRouter } from '@/app/router';
import { resetMockState } from '@/mocks/handlers';
import { resetFavoritesMemoryForTests } from '@/lib/favoritesStorage';
import { resetCsrfForTests } from '@/lib/api/client';

export function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, staleTime: 0, gcTime: Infinity, refetchOnWindowFocus: false },
    mutations: { retry: false },
  });
  return client;
}

/** Fresh mock server state + CSRF memo + favourites memory. Call from `beforeEach`. */
export function resetTestWorld() {
  resetMockState();
  resetFavoritesMemoryForTests();
  resetCsrfForTests();
}

/** Router + all providers around a single element (use for pages/components that need routing or data). */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    routes,
    ...options
  }: { route?: string; routes?: RouteObject[] } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const client = testQueryClient();
  const router = createMemoryRouter(routes ?? [{ path: '*', element: ui }], {
    initialEntries: [route],
  });
  const result = render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
    options,
  );
  return { ...result, client, router };
}

/** Whole application (real route table) at `route`. */
export function renderApp(route = '/') {
  const client = testQueryClient();
  const router = createTestRouter([route]);
  const result = render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, client, router };
}

/** Router only (design components that render links). */
export function renderInRouter(ui: ReactElement, route = '/') {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

/** Queries scoped to the page content (the footer newsletter form also has an email field). */
export const withinMain = () => ({
  findByLabelText: async (...args: Parameters<typeof screen.findByLabelText>) =>
    within(await screen.findByRole('main')).findByLabelText(...args),
  getByLabelText: (...args: Parameters<typeof screen.getByLabelText>) =>
    within(screen.getByRole('main')).getByLabelText(...args),
});

/** axe-core in jsdom. Colour contrast is verified separately by the token tests (jsdom has no layout/CSS). */
export async function expectNoA11yViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`,
  );
  expect(summary).toEqual([]);
}
