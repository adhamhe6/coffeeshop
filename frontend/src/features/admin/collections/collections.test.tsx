import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderWithProviders, resetTestWorld } from '@/test/utils';
import {
  API,
  CAPS,
  collection,
  mockCatalogApi,
  productRow,
  signInAs,
} from '../catalog-kit/testing';
import AdminCollectionsPage from './pages/CollectionsPage';

beforeEach(() => resetTestWorld());

const p = (id: number, name: string) => ({
  id,
  name,
  slug: name.toLowerCase(),
  image: null,
  is_active: true,
  base_price: '3.00',
});
const coll = collection({
  id: 1,
  name: 'Bestsellers',
  product_ids: [1, 2],
  products: [p(1, 'Espresso'), p(2, 'Latte')],
  product_count: 2,
});

describe('collections', () => {
  it('reorders products, adds one from search and saves the ordered ids', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({
      collections: [coll],
      products: [productRow({ id: 3, name: 'Mocha', sku: 'LC-0301' })],
    });
    let put: unknown;
    server.use(
      http.patch(`${API}/admin/collections/1/`, () => HttpResponse.json(coll)),
      http.put(`${API}/admin/collections/1/products/`, async ({ request }) => {
        put = await request.json();
        return HttpResponse.json({ ...coll, product_ids: [2, 1, 3] });
      }),
    );
    renderWithProviders(<AdminCollectionsPage />, { route: '/admin/collections?collection=1' });
    await screen.findByRole('form', { name: 'Edit collection Bestsellers' });
    await userEvent.click(screen.getByRole('button', { name: 'Move Latte up' }));
    await userEvent.type(screen.getByLabelText('Add products'), 'moc');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Mocha' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save collection' }));
    await waitFor(() => expect(put).toEqual({ product_ids: [2, 1, 3] }));
    expect(await screen.findByText('Bestsellers was saved.')).toBeInTheDocument();
  });

  it('is read-only for roles without catalog.manage', async () => {
    signInAs(CAPS.orderManager);
    mockCatalogApi({ collections: [coll] });
    renderWithProviders(<AdminCollectionsPage />, { route: '/admin/collections?collection=1' });
    await screen.findByRole('form', { name: 'Edit collection Bestsellers' });
    expect(screen.queryByLabelText('Add products')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save collection' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Latte up' })).toBeDisabled();
  });
});
