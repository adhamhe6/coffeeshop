import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderWithProviders, resetTestWorld } from '@/test/utils';
import { API, apiError, CAPS, mockCatalogApi, productRow, signInAs } from '../catalog-kit/testing';
import AdminProductsListPage from './pages/ProductsListPage';

beforeEach(() => resetTestWorld());

const rows = [
  productRow({ id: 1, name: 'Espresso', sku: 'LC-0101' }),
  productRow({ id: 2, name: 'Latte', sku: 'LC-0201', slug: 'latte', is_featured: true }),
  productRow({
    id: 3,
    name: 'Old Mug',
    sku: 'LC-1201',
    slug: 'old-mug',
    is_active: false,
    stock_mode: 'STOCKED',
    stock_total: 2,
    low_stock: true,
  }),
];

function renderList(route = '/admin/products') {
  window.innerWidth = 1440; // table layout (cards below 1200px)
  return renderWithProviders(<AdminProductsListPage />, { route });
}

describe('products list', () => {
  it('shows products with status badges, stock and per-row toggles for a product manager', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ products: rows });
    renderList();
    expect(await screen.findByRole('link', { name: 'Espresso' })).toBeInTheDocument();
    const mug = screen.getByRole('link', { name: 'Old Mug' }).closest('tr')!;
    expect(within(mug).getByText('Archived')).toBeInTheDocument();
    expect(within(mug).getByText('Low stock')).toBeInTheDocument();
    expect(within(mug).getByText('2 in stock')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New product' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sold out: Espresso' })).toBeEnabled();
  });

  it('hides editing controls for roles without catalog.manage (order manager)', async () => {
    signInAs(CAPS.orderManager);
    mockCatalogApi({ products: rows });
    renderList();
    await screen.findByRole('link', { name: 'Espresso' });
    expect(screen.queryByRole('link', { name: 'New product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Select Espresso/ })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sold out: Espresso' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'View Espresso' })).toBeInTheDocument();
  });

  it('toggles optimistically and keeps the new value when the API accepts it', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ products: rows });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const patched: unknown[] = [];
    server.use(
      http.patch(`${API}/admin/products/:id/`, async ({ request }) => {
        patched.push(await request.json());
        await gate;
        return HttpResponse.json({ ...rows[0], is_sold_out: true });
      }),
    );
    renderList();
    const toggle = await screen.findByRole('switch', { name: 'Sold out: Espresso' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    // optimistic: flips before the server has answered
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(patched).toEqual([{ is_sold_out: true }]);
    release();
    expect(await screen.findByText('Espresso is marked sold out.')).toBeInTheDocument();
  });

  it('rolls the toggle back and explains why when the API refuses', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ products: rows });
    server.use(
      http.patch(`${API}/admin/products/:id/`, () =>
        apiError(403, 'permission_denied', 'You do not have permission to perform this action.'),
      ),
    );
    renderList();
    const toggle = await screen.findByRole('switch', { name: 'Featured: Espresso' });
    await userEvent.click(toggle);
    expect(await screen.findByText(/Could not update Espresso/)).toBeInTheDocument();
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('runs bulk actions one by one with progress and reports partial failures', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ products: rows });
    const order: number[] = [];
    server.use(
      http.patch(`${API}/admin/products/:id/`, async ({ params, request }) => {
        order.push(Number(params.id));
        expect(await request.json()).toEqual({ is_active: false });
        if (params.id === '2') return apiError(409, 'conflict', 'Latte is locked by another edit.');
        return HttpResponse.json(rows[0]);
      }),
    );
    renderList();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Espresso' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Latte' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive products' });
    expect(within(dialog).getByText(/disappear from the storefront/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archiving 2 products' }));
    expect(await within(dialog).findByText('1 updated, 1 failed')).toBeInTheDocument();
    expect(within(dialog).getByText(/locked by another edit/)).toBeInTheDocument();
    expect(order).toEqual([1, 2]);
    expect(within(dialog).getByRole('button', { name: 'Retry 1 failed' })).toBeInTheDocument();
  });

  it('keeps filters in the URL and sends them to the API', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ products: rows });
    const seen: string[] = [];
    server.use(
      http.get(`${API}/admin/products/`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      }),
    );
    renderList('/admin/products?status=archived&low=1&q=mug');
    await screen.findByText('No products match these filters');
    const query = new URLSearchParams(seen.at(-1));
    expect(query.get('active')).toBe('false');
    expect(query.get('low_stock')).toBe('true');
    expect(query.get('q')).toBe('mug');
  });
});
