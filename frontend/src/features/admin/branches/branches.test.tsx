import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderWithProviders, resetTestWorld } from '@/test/utils';
import {
  API,
  apiError,
  branch,
  CAPS,
  mockCatalogApi,
  paged,
  signInAs,
  weekHours,
} from '../catalog-kit/testing';
import AdminBranchesPage from './pages/BranchesPage';

beforeEach(() => resetTestWorld());

function setup(
  role = CAPS.admin,
  branchIds: number[] | null = null,
  branches = [branch(), branch({ id: 2, code: 'RS', name: 'Riverside', slug: 'riverside' })],
) {
  signInAs(role, branchIds);
  mockCatalogApi();
  server.use(
    http.get(`${API}/admin/branches/`, () => HttpResponse.json(paged(branches))),
    http.get(`${API}/admin/branches/:id/hours/`, () => HttpResponse.json(weekHours())),
    http.get(`${API}/admin/branches/:id/closures/`, () => HttpResponse.json([])),
    http.get(`${API}/admin/branches/:id/zones/`, () => HttpResponse.json([])),
    http.get(`${API}/admin/branches/:id/staff/`, () => HttpResponse.json([])),
    http.get(`${API}/admin/delivery-zones/`, () => HttpResponse.json(paged([]))),
  );
}

describe('branches', () => {
  it('pauses orders only after confirmation', async () => {
    setup();
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/admin/branches/1/`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(branch({ accepting_orders: false }));
      }),
    );
    renderWithProviders(<AdminBranchesPage />, { route: '/admin/branches?branch=1' });
    await userEvent.click(await screen.findByRole('button', { name: 'Pause orders' }));
    const dialog = await screen.findByRole('dialog', { name: /Pause orders at Downtown Flagship/ });
    expect(bodies).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause orders' }));
    await waitFor(() => expect(bodies).toEqual([{ accepting_orders: false }]));
    expect(await screen.findByText('Orders are paused at Downtown Flagship.')).toBeInTheDocument();
  });

  it('branch managers see only their branch and cannot create, delete or change protected fields', async () => {
    setup(CAPS.branchManager, [1], [branch()]);
    renderWithProviders(<AdminBranchesPage />);
    expect(await screen.findByRole('heading', { name: 'Downtown Flagship' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New branch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Riverside')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Code/)).toBeDisabled();
    expect(screen.getByLabelText(/^Slug/)).toBeDisabled();
    expect(screen.getByLabelText(/^Name/)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pause orders' })).toBeInTheDocument();
  });

  it('read-only role (inventory manager with branches.view) can look but not change', async () => {
    setup(CAPS.inventoryManager, null);
    renderWithProviders(<AdminBranchesPage />, { route: '/admin/branches?branch=1' });
    expect(await screen.findByLabelText(/^Name/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Pause orders' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Pickup' })).toBeDisabled();
  });

  it('hours editor: validates opens < closes, copies a day to all days and saves the week', async () => {
    setup();
    let body: {
      hours: Array<{
        weekday: number;
        is_closed: boolean;
        opens: string | null;
        closes: string | null;
      }>;
    } | null = null;
    server.use(
      http.put(`${API}/admin/branches/1/hours/`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(body!.hours);
      }),
    );
    renderWithProviders(<AdminBranchesPage />, { route: '/admin/branches?branch=1' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Opening hours' }));
    const closes = await screen.findByLabelText('Monday closes');
    fireEvent.change(closes, { target: { value: '06:00' } });
    expect(await screen.findByText('Closing time must be after opening time.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(body).toBeNull();

    fireEvent.change(closes, { target: { value: '20:00' } });
    await waitFor(() =>
      expect(
        screen.queryByText('Closing time must be after opening time.'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Sunday opens')).not.toBeInTheDocument(); // Sunday is closed
    await userEvent.click(screen.getByRole('button', { name: 'Copy Monday hours to all days' }));
    expect(screen.getByLabelText('Sunday opens')).toHaveValue('07:00');
    expect(screen.getByLabelText('Sunday closes')).toHaveValue('20:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.hours).toHaveLength(7);
    expect(
      body!.hours.every((h) => !h.is_closed && h.opens === '07:00' && h.closes === '20:00'),
    ).toBe(true);
    expect(
      await screen.findByText('Opening hours of Downtown Flagship saved.'),
    ).toBeInTheDocument();
  });

  it('surfaces a server error when saving hours fails', async () => {
    setup();
    server.use(
      http.put(`${API}/admin/branches/1/hours/`, () =>
        apiError(403, 'forbidden', 'Only administrators can do this.'),
      ),
    );
    renderWithProviders(<AdminBranchesPage />, { route: '/admin/branches?branch=1' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Opening hours' }));
    await userEvent.click(await screen.findByRole('switch', { name: 'Sunday open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only administrators can do this.');
  });
});
