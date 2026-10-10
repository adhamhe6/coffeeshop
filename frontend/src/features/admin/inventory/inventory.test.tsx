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
  mockCatalogApi,
  paged,
  signInAs,
  stockItem,
  summary,
} from '../catalog-kit/testing';
import AdminInventoryPage from './pages/InventoryPage';

beforeEach(() => resetTestWorld());

function setup(role: string[] = CAPS.inventoryManager, items = [stockItem()], sum = summary()) {
  signInAs(role);
  mockCatalogApi();
  server.use(
    http.get(`${API}/admin/inventory/summary/`, () => HttpResponse.json(sum)),
    http.get(`${API}/admin/inventory/stock/`, () => HttpResponse.json(paged(items))),
    http.get(`${API}/admin/inventory/movements/`, () => HttpResponse.json(paged([]))),
  );
  window.innerWidth = 1440;
}

describe('inventory page', () => {
  it('shows summary cards and a low-stock alert banner', async () => {
    setup(
      CAPS.inventoryManager,
      [stockItem({ quantity: 2, is_low: true })],
      summary({ low_stock_count: 2, out_of_stock_count: 1 }),
    );
    renderWithProviders(<AdminInventoryPage />);
    expect(
      await screen.findByText(/2 items are at or below the low-stock alert level, 1 out of stock/),
    ).toBeInTheDocument();
    expect(screen.getByText('Tracked items')).toBeInTheDocument();
    expect(screen.getByText('$120.50')).toBeInTheDocument();
    expect(await screen.findByText('Low stock', { selector: 'span' })).toBeInTheDocument();
  });

  it('lets an inventory manager adjust stock but hides it from read-only roles (product manager)', async () => {
    setup(CAPS.productManager);
    renderWithProviders(<AdminInventoryPage />);
    await screen.findByText('Decaf Colombia');
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Adjust stock of/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Movement history of Decaf Colombia/ }),
    ).toBeInTheDocument();
  });

  it('adjust dialog: requires a reason for waste, previews the result and sends the delta', async () => {
    setup();
    let body: unknown;
    server.use(
      http.post(`${API}/admin/inventory/adjust/`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { stock_item: stockItem({ quantity: 5 }), movement: {} },
          { status: 201 },
        );
      }),
    );
    renderWithProviders(<AdminInventoryPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Adjust stock of Decaf Colombia at Downtown' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Adjust stock' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /Waste/ }));
    await userEvent.type(within(dialog).getByLabelText(/^Units wasted/), '3');
    expect(within(dialog).getByRole('status')).toHaveTextContent('from 8 to 5');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Record movement' }));
    expect(
      await within(dialog).findByText('A reason is required for adjustments and waste.'),
    ).toBeInTheDocument();
    expect(body).toBeUndefined();

    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Expired');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record movement' }));
    await waitFor(() =>
      expect(body).toEqual({
        branch: 1,
        product: 61,
        movement_type: 'WASTE',
        delta: -3,
        reason: 'Expired',
        reference: '',
      }),
    );
    expect(await screen.findByText('Decaf Colombia at Downtown: 8 → 5.')).toBeInTheDocument();
  });

  it('blocks removing more than is in stock on the client and handles a server 409 gracefully', async () => {
    setup();
    server.use(
      http.post(`${API}/admin/inventory/adjust/`, () =>
        apiError(409, 'insufficient_stock', 'Only 2 in stock; cannot remove 3.'),
      ),
    );
    renderWithProviders(<AdminInventoryPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Adjust stock of Decaf Colombia at Downtown' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Adjust stock' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Adjustment/ }));
    await userEvent.type(within(dialog).getByLabelText(/^Change/), '-9');
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), 'Recount');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record movement' }));
    expect(
      await within(dialog).findByText('Only 8 in stock; you cannot remove 9.'),
    ).toBeInTheDocument();

    const change = within(dialog).getByLabelText(/^Change/);
    await userEvent.clear(change);
    await userEvent.type(change, '-3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record movement' }));
    expect(
      await within(dialog).findByText(/Only 2 in stock; cannot remove 3\. Refresh the stock level/),
    ).toBeInTheDocument();
    expect(dialog).toBeInTheDocument(); // stays open so nothing is lost
  }, 20_000);

  it('switches off a prepared item for the day (86 it) with rollback on failure', async () => {
    setup();
    const row = {
      product: { id: 5, name: 'Basque Cheesecake', sku: 'LC-0902', slug: 'x', image: null },
      category_name: 'Cakes',
      is_available: true,
      is_sold_out: false,
      updated_at: null,
    };
    server.use(
      http.get(`${API}/admin/inventory/availability/`, () => HttpResponse.json(paged([row]))),
      http.patch(`${API}/admin/inventory/availability/`, () =>
        apiError(403, 'forbidden', 'Not allowed.'),
      ),
    );
    renderWithProviders(<AdminInventoryPage />, { route: '/admin/inventory?tab=availability' });
    const toggle = await screen.findByRole('switch', {
      name: 'Available at Downtown: Basque Cheesecake',
    });
    await userEvent.click(toggle);
    expect(await screen.findByText(/Could not update Basque Cheesecake/)).toBeInTheDocument();
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });
});
