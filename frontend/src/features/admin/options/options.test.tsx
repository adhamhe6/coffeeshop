import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderWithProviders, resetTestWorld } from '@/test/utils';
import { API, apiError, CAPS, group, mockCatalogApi, signInAs } from '../catalog-kit/testing';
import AdminOptionsPage from './pages/OptionsPage';

beforeEach(() => resetTestWorld());

const milk = group({
  id: 2,
  name: 'Milk',
  display_name: 'Milk',
  is_required: false,
  min_select: 0,
  product_count: 0,
  options: [
    {
      id: 10,
      name: 'Whole milk',
      price_delta: '0.00',
      is_default: true,
      is_active: true,
      is_available: true,
      sort_order: 0,
    },
    {
      id: 11,
      name: 'Oat milk',
      price_delta: '0.60',
      is_default: false,
      is_active: true,
      is_available: true,
      sort_order: 1,
    },
  ],
});

describe('modifier group editor', () => {
  it('validates min/max live with the same rules as the server', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ groups: [group(), milk] });
    renderWithProviders(<AdminOptionsPage />, { route: '/admin/options?group=2' });
    await screen.findByRole('form', { name: 'Edit group Milk' });
    await userEvent.click(screen.getByRole('radio', { name: /Choose several/ }));
    const max = screen.getByLabelText('Maximum choices');
    expect(max).toBeEnabled();
    await userEvent.clear(max);
    await userEvent.type(max, '3');
    expect(screen.getByText(/Customers will see:/)).toHaveTextContent('Choose up to 3');

    // required => needs a minimum of at least 1
    await userEvent.click(screen.getByRole('switch', { name: 'Required' }));
    expect(screen.getByLabelText('Minimum choices')).toHaveValue('1');
    const min = screen.getByLabelText('Minimum choices');
    await userEvent.clear(min);
    await userEvent.type(min, '5');
    expect(await screen.findByText('Minimum cannot exceed the maximum.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save group' })).toBeDisabled();

    await userEvent.clear(min);
    await userEvent.type(min, '0');
    expect(
      await screen.findByText('A required group needs a minimum of at least 1.'),
    ).toBeInTheDocument();
    await userEvent.clear(min);
    await userEvent.type(min, '2');
    await waitFor(() =>
      expect(screen.queryByText(/Minimum cannot exceed/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Customers will see:/)).toHaveTextContent('Choose 2 to 3');
    expect(screen.getByRole('button', { name: 'Save group' })).toBeEnabled();
  });

  it('a choose-one group locks max to 1', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ groups: [group()] });
    renderWithProviders(<AdminOptionsPage />, { route: '/admin/options?group=1' });
    await screen.findByRole('form', { name: /Edit group Size/ });
    expect(screen.getByLabelText('Maximum choices')).toBeDisabled();
    expect(screen.getByLabelText('Maximum choices')).toHaveValue('1');
  });

  it('quick-toggles an option as unavailable (out of oat milk) and rolls back on failure', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ groups: [milk] });
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/admin/modifier-groups/2/options/11/`, async ({ request }) => {
        bodies.push(await request.json());
        return bodies.length === 1
          ? HttpResponse.json({ ...milk.options[1], is_available: false })
          : apiError(500, 'server_error', 'Nope.');
      }),
    );
    renderWithProviders(<AdminOptionsPage />, { route: '/admin/options?group=2' });
    const toggle = await screen.findByRole('switch', { name: 'Available: Oat milk' });
    await userEvent.click(toggle);
    expect(await screen.findByText('Oat milk is marked unavailable.')).toBeInTheDocument();
    expect(bodies[0]).toEqual({ is_available: false });
    await userEvent.click(screen.getByRole('switch', { name: 'Active: Oat milk' }));
    expect(await screen.findByText(/Could not update Oat milk/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Active: Oat milk' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('adds an option with a validated, normalised price adjustment', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ groups: [milk] });
    let body: unknown;
    server.use(
      http.post(`${API}/admin/modifier-groups/2/options/`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 12, ...(body as object) }, { status: 201 });
      }),
    );
    renderWithProviders(<AdminOptionsPage />, { route: '/admin/options?group=2' });
    await userEvent.click(await screen.findByRole('button', { name: 'Add option' }));
    const dialog = await screen.findByRole('dialog', { name: /Add option to Milk/ });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Almond milk');
    const price = within(dialog).getByLabelText(/^Price adjustment/);
    await userEvent.clear(price);
    await userEvent.type(price, '900');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add option' }));
    expect(
      await within(dialog).findByText('Price adjustment must be between -50.00 and 500.00.'),
    ).toBeInTheDocument();
    await userEvent.clear(price);
    await userEvent.type(price, '0.6');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add option' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        name: 'Almond milk',
        price_delta: '0.60',
        is_available: true,
        is_active: true,
      }),
    );
  });

  it('shows safe-delete guidance when the group is in use', async () => {
    signInAs(CAPS.productManager);
    mockCatalogApi({ groups: [group({ id: 1, product_count: 3 })] });
    server.use(
      http.delete(`${API}/admin/modifier-groups/1/`, () =>
        apiError(
          409,
          'in_use',
          'This group is attached to products or appears in order history. Detach it from its products or deactivate it instead of deleting.',
        ),
      ),
    );
    renderWithProviders(<AdminOptionsPage />, { route: '/admin/options?group=1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete group' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete Size/ });
    expect(within(dialog).getByText(/attached to 3 product/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete group' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/deactivate it instead/);
  });

  it('shows how many products use each group', async () => {
    signInAs(CAPS.orderManager);
    mockCatalogApi({ groups: [group({ product_count: 33 })] });
    renderWithProviders(<AdminOptionsPage />);
    expect(await screen.findByText(/used by 33 products/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New group' })).not.toBeInTheDocument();
  });
});
