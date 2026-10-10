import { act, screen, waitFor, within } from '@testing-library/react';
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
  collection,
  group,
  mockCatalogApi,
  product,
  signInAs,
} from '../catalog-kit/testing';
import AdminProductEditorPage from './pages/ProductEditorPage';

beforeEach(() => resetTestWorld());

const routes = [
  { path: '/admin/products/new', element: <AdminProductEditorPage /> },
  { path: '/admin/products/:id', element: <AdminProductEditorPage /> },
  { path: '/admin/products', element: <p>Products list page</p> },
];

const cats = [
  category({ id: 2, name: 'Milk Coffee', slug: 'milk-coffee' }),
  category({ id: 3, name: 'Beans', slug: 'beans' }),
];
const groups = [
  group({ id: 5, name: 'Size (drinks)' }),
  group({ id: 6, name: 'Milk', display_name: 'Milk', is_required: false, min_select: 0 }),
];

function renderEditor(route: string) {
  return renderWithProviders(<AdminProductEditorPage />, { route, routes });
}

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(label) }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('new product', () => {
  it('suggests a slug from the name and validates required fields before calling the API', async () => {
    signInAs(CAPS.productManager);
    const api = mockCatalogApi({ categories: cats, groups });
    renderEditor('/admin/products/new');
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Café Crème Latte');
    expect(screen.getByLabelText(/^Slug/)).toHaveValue('cafe-creme-latte');

    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('Enter a SKU.')).toBeInTheDocument();
    expect(screen.getByText('Choose a category.')).toBeInTheDocument();
    expect(screen.getByText('Enter a price.')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('creates the product with a decimal-string price and ordered group ids, then opens the editor', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ categories: cats, groups });
    let body: Record<string, unknown> | null = null;
    const created = product({
      id: 7,
      name: 'Flat White',
      slug: 'flat-white',
      sku: 'LC-0203',
      category: 2,
      category_name: 'Milk Coffee',
      base_price: '4.40',
      modifier_group_ids: [6, 5],
    });
    server.use(
      http.post(`${API}/admin/products/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get(`${API}/admin/products/7/`, () => HttpResponse.json(created)),
    );
    const { router } = renderEditor('/admin/products/new');
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Flat White');
    await userEvent.type(screen.getByLabelText(/^SKU/), 'LC-0203');
    await choose('Category', 'Milk Coffee');
    await userEvent.type(screen.getByLabelText(/^Base price/), '4.4');
    await choose('Add an option group', 'Milk');
    await choose('Add an option group', 'Size (drinks)');
    expect(screen.getByRole('list', { name: 'Attached option groups' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/products/7'));
    expect(body).toMatchObject({
      name: 'Flat White',
      slug: 'flat-white',
      sku: 'LC-0203',
      category: 2,
      base_price: '4.40',
      modifier_group_ids: [6, 5],
      is_active: true,
    });
    expect(typeof (body as { base_price: unknown } | null)?.base_price).toBe('string');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Flat White' }),
    ).toBeInTheDocument();
  });

  it('maps slug and SKU conflicts from the server onto their fields', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ categories: cats, groups });
    server.use(
      http.post(`${API}/admin/products/`, () =>
        apiError(400, 'validation_error', 'Please correct the highlighted fields.', {
          slug: ['A product with this slug already exists.'],
          sku: ['product with this sku already exists.'],
        }),
      ),
    );
    renderEditor('/admin/products/new');
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Latte');
    await userEvent.type(screen.getByLabelText(/^SKU/), 'LC-0201');
    await choose('Category', 'Milk Coffee');
    await userEvent.type(screen.getByLabelText(/^Base price/), '4.5');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('A product with this slug already exists.')).toBeInTheDocument();
    expect(screen.getByText('product with this sku already exists.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Slug/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^SKU/)).toHaveAttribute('aria-invalid', 'true');
    // still on the form, nothing navigated
    expect(screen.getByRole('button', { name: 'Create product' })).toBeEnabled();
  });
});

describe('editing a product', () => {
  const existing = product({
    id: 7,
    name: 'Flat White',
    slug: 'flat-white',
    sku: 'LC-0203',
    category: 2,
    category_name: 'Milk Coffee',
    base_price: '4.40',
  });

  it('shows the audited price-change notice and sends only the changed field', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({
      product: existing,
      categories: cats,
      groups,
      collections: [collection({ id: 1 })],
    });
    let patch: unknown = null;
    server.use(
      http.patch(`${API}/admin/products/7/`, async ({ request }) => {
        patch = await request.json();
        return HttpResponse.json({ ...existing, base_price: '4.90' });
      }),
    );
    renderEditor('/admin/products/7');
    const price = await screen.findByLabelText(/^Base price/);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await userEvent.clear(price);
    await userEvent.type(price, '4.9');
    expect(await screen.findByText(/recorded in the audit log/)).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Flat White was saved.')).toBeInTheDocument();
    expect(patch).toEqual({ base_price: '4.90' });
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeInTheDocument());
  });

  it('asks before leaving with unsaved changes', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ product: existing, categories: cats, groups });
    const { router } = renderEditor('/admin/products/7');
    await userEvent.type(await screen.findByLabelText(/^Name/), ' Iced');
    await act(async () => {
      void router.navigate('/admin/products');
    });
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/admin/products/7');
    await act(async () => {
      void router.navigate('/admin/products');
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/products'));
  });

  it('is read-only without catalog.manage: no save bar, fields disabled', async () => {
    signInAs(CAPS.orderManager);
    mockCatalogApi({ product: existing, categories: cats, groups });
    renderEditor('/admin/products/7');
    expect(await screen.findByLabelText(/^Name/)).toBeDisabled();
    expect(screen.getByText(/your role cannot change it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('explains has_orders when deleting and offers to archive instead', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ product: existing, categories: cats, groups });
    let archived = false;
    server.use(
      http.delete(`${API}/admin/products/7/`, () =>
        apiError(
          409,
          'has_orders',
          'Flat White appears on 3 order line(s) and cannot be deleted. Archive it instead.',
        ),
      ),
      http.post(`${API}/admin/products/7/archive/`, () => {
        archived = true;
        return HttpResponse.json({ ...existing, is_active: false });
      }),
    );
    renderEditor('/admin/products/7');
    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog', { name: /Delete Flat White/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete product' }));
    expect(await within(dialog).findByText(/appears on 3 order line/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Archive it instead: customers will no longer see or order it/),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Delete product' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive instead' }));
    await waitFor(() => expect(archived).toBe(true));
  });
});
