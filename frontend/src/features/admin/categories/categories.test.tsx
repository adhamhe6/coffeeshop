import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderWithProviders, resetTestWorld } from '@/test/utils';
import {
  API,
  apiError,
  CAPS,
  category,
  mockCatalogApi,
  paged,
  signInAs,
} from '../catalog-kit/testing';
import AdminCategoriesPage from './pages/CategoriesPage';

beforeEach(() => resetTestWorld());

const cats = [
  category({ id: 1, name: 'Espresso', slug: 'espresso' }),
  category({
    id: 2,
    name: 'Milk Coffee',
    slug: 'milk-coffee',
    product_count: 5,
    active_product_count: 5,
  }),
  category({ id: 3, name: 'Tea', slug: 'tea' }),
];

describe('categories', () => {
  it('reorders with the arrow buttons and saves the full id order', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ categories: cats });
    let body: unknown;
    let current = cats;
    server.use(
      http.get(`${API}/admin/categories/`, () => HttpResponse.json(paged(current))),
      http.post(`${API}/admin/categories/reorder/`, async ({ request }) => {
        body = await request.json();
        current = [cats[1]!, cats[0]!, cats[2]!];
        return HttpResponse.json(current);
      }),
    );
    renderWithProviders(<AdminCategoriesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Milk Coffee up' }));
    await waitFor(() => expect(body).toEqual({ ids: [2, 1, 3] }));
    expect(await screen.findByText('Category order saved.')).toBeInTheDocument();
    const names = screen
      .getAllByRole('listitem')
      .map((li) => within(li).queryByText(/^(Espresso|Milk Coffee|Tea)$/)?.textContent);
    expect(names.slice(0, 3)).toEqual(['Milk Coffee', 'Espresso', 'Tea']);
  });

  it('puts the order back and shows the reason when saving the order fails', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ categories: cats });
    server.use(
      http.post(`${API}/admin/categories/reorder/`, () =>
        apiError(500, 'server_error', 'Database is busy.'),
      ),
    );
    renderWithProviders(<AdminCategoriesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Espresso down' }));
    expect(await screen.findByText(/Could not save the new order/)).toBeInTheDocument();
    await waitFor(() => {
      const first = screen.getAllByRole('listitem')[0]!;
      expect(within(first).getByText('Espresso')).toBeInTheDocument();
    });
  });

  it('explains delete protection when a category still has products', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ categories: cats });
    server.use(
      http.delete(`${API}/admin/categories/2/`, () =>
        apiError(
          409,
          'has_products',
          'Milk Coffee still has 5 product(s). Move or archive them first, or deactivate the category to hide it from the storefront.',
        ),
      ),
    );
    renderWithProviders(<AdminCategoriesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Milk Coffee' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete Milk Coffee/ });
    expect(within(dialog).getByText(/still has 5 product/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete category' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/deactivate the category/);
  });

  it('hides management controls for read-only roles', async () => {
    signInAs(CAPS.orderManager);
    mockCatalogApi({ categories: cats });
    renderWithProviders(<AdminCategoriesPage />);
    await screen.findByText('Milk Coffee');
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Tea up' })).toBeDisabled();
  });
});
