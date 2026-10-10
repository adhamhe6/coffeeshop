import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp, resetTestWorld } from '@/test/utils';
import { ROLE_CAPS, signInAsStaff } from '../people-kit/testing';
import { generateTemporaryPassword } from './password';

const A = '/api/v1/admin';
const err = (status: number, code: string, message: string, fields?: Record<string, string[]>) =>
  HttpResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}), request_id: 'r1' } },
    { status },
  );

const matrix = {
  capabilities: [
    'orders.view',
    'orders.manage',
    'customers.view',
    'promotions.manage',
    'staff.manage',
  ],
  roles: [
    {
      role: 'SUPER_ADMIN',
      label: 'Super admin',
      capabilities: [
        'customers.view',
        'orders.manage',
        'orders.view',
        'promotions.manage',
        'staff.manage',
      ],
      is_global: true,
      branch_required: false,
    },
    {
      role: 'ADMIN',
      label: 'Admin',
      capabilities: ['customers.view', 'orders.manage', 'orders.view', 'promotions.manage'],
      is_global: true,
      branch_required: false,
    },
    {
      role: 'BRANCH_MANAGER',
      label: 'Branch manager',
      capabilities: ['customers.view', 'orders.manage', 'orders.view'],
      is_global: false,
      branch_required: true,
    },
    {
      role: 'MARKETING_MANAGER',
      label: 'Marketing manager',
      capabilities: ['promotions.manage'],
      is_global: false,
      branch_required: false,
    },
  ],
};

const member = (over: Record<string, unknown> = {}) => ({
  id: 20,
  email: 'nia@x.example',
  first_name: 'Nia',
  last_name: 'Campbell',
  phone: '',
  role: 'MARKETING_MANAGER',
  role_label: 'Marketing manager',
  job_title: 'Marketing',
  branch_ids: [],
  branches: [],
  is_active: true,
  last_login: null,
  date_joined: '2026-01-01T00:00:00Z',
  ...over,
});

function mockStaff(
  list = [
    member(),
    member({
      id: 1,
      email: 'sam@x.example',
      first_name: 'Sam',
      last_name: 'Staff',
      role: 'SUPER_ADMIN',
      role_label: 'Super admin',
    }),
  ],
) {
  server.use(
    http.get(`${A}/staff/roles/`, () => HttpResponse.json(matrix)),
    http.get(`${A}/staff/`, () =>
      HttpResponse.json({ count: list.length, next: null, previous: null, results: list }),
    ),
  );
}

beforeEach(() => resetTestWorld());

describe('role and permission matrix', () => {
  it('renders roles as columns and capabilities as grouped rows with text for every cell', async () => {
    signInAsStaff('SUPER_ADMIN');
    mockStaff();
    renderApp('/admin/staff?tab=roles');
    const table = await screen.findByRole('table', {
      name: 'What each staff role is allowed to do',
    });
    for (const label of ['Super admin', 'Admin', 'Branch manager', 'Marketing manager'])
      expect(
        within(table).getByRole('columnheader', { name: new RegExp(label) }),
      ).toBeInTheDocument();
    expect(within(table).getByText('Orders')).toBeInTheDocument(); // group row
    const row = within(table).getByRole('row', { name: /Create and edit coupons and promotions/ });
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    // Super admin, Admin, Branch manager, Marketing manager
    expect(cells).toEqual(['Allowed', 'Allowed', 'Not allowed', 'Allowed']);
    expect(within(table).getByText('Assigned branches')).toBeInTheDocument();
  });
});

describe('staff dialog rules', () => {
  it(
    'requires a branch for branch-scoped roles and hides the picker for global roles',
    { timeout: 20_000 },
    async () => {
      signInAsStaff('SUPER_ADMIN');
      mockStaff();
      let body: Record<string, unknown> | undefined;
      server.use(
        http.post(`${A}/staff/`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(member({ id: 30, role: 'BRANCH_MANAGER' }), { status: 201 });
        }),
      );
      renderApp('/admin/staff');
      await userEvent.click(await screen.findByRole('button', { name: 'Add staff member' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add a staff member' });

      await userEvent.type(within(dialog).getByLabelText(/^First name/), 'Ben');
      await userEvent.type(within(dialog).getByLabelText(/^Email/), 'ben@x.example');
      await userEvent.type(within(dialog).getByLabelText(/^Temporary password/), 'correct-horse-9');

      await userEvent.click(within(dialog).getByRole('combobox', { name: /Role/ }));
      await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
      expect(within(dialog).queryByRole('group', { name: /Branches/ })).not.toBeInTheDocument();
      expect(within(dialog).getByText(/has access to every branch/)).toBeInTheDocument();
      // capability preview for the chosen role
      expect(
        within(dialog).getByRole('region', { name: 'What the Admin role can do' }),
      ).toHaveTextContent('Create and edit coupons and promotions');

      await userEvent.click(within(dialog).getByRole('combobox', { name: /Role/ }));
      await userEvent.click(await screen.findByRole('option', { name: 'Branch manager' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff member' }));
      expect(
        await within(dialog).findByText(/must be assigned to at least one branch/),
      ).toBeInTheDocument();
      expect(body).toBeUndefined();

      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Riverside' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff member' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({
        email: 'ben@x.example',
        first_name: 'Ben',
        role: 'BRANCH_MANAGER',
        branch_ids: [2],
        password: 'correct-horse-9',
      });
    },
  );

  it('shows temporary-password guidance and validates length', async () => {
    signInAsStaff('SUPER_ADMIN');
    mockStaff();
    renderApp('/admin/staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Add staff member' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Temporary password/), 'short');
    expect(within(dialog).getByText(/At least 10 characters/)).toHaveTextContent('not met yet');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Generate a strong password' }),
    );
    expect(within(dialog).getByText('Strong')).toBeInTheDocument();
  });

  it('only a super admin can pick the super admin role', async () => {
    // An ADMIN role holding staff.manage (it does not in reality) isolates the dialog rule.
    signInAsStaff('ADMIN', 1, ROLE_CAPS.SUPER_ADMIN);
    mockStaff();
    renderApp('/admin/staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Add staff member' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Role/ }));
    expect(
      await screen.findByRole('option', { name: /Super admin \(super admins only\)/ }),
    ).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('activation protections', () => {
  it('disables self-deactivation and surfaces the server message for the last super admin', async () => {
    signInAsStaff('SUPER_ADMIN', 1);
    mockStaff([
      member({
        id: 1,
        email: 'sam@x.example',
        first_name: 'Sam',
        role: 'SUPER_ADMIN',
        role_label: 'Super admin',
      }),
      member({
        id: 2,
        email: 'other@x.example',
        first_name: 'Olive',
        role: 'SUPER_ADMIN',
        role_label: 'Super admin',
      }),
    ]);
    server.use(
      http.post(`${A}/staff/2/deactivate/`, () =>
        err(409, 'last_super_admin', 'At least one active super admin must remain.'),
      ),
    );
    renderApp('/admin/staff');
    const self = await screen.findByRole('button', {
      name: /Deactivate Sam Campbell.*cannot deactivate your own/,
    });
    expect(self).toBeDisabled();

    await userEvent.click(await screen.findByRole('button', { name: /^Deactivate Olive/ }));
    const dialog = await screen.findByRole('dialog', { name: /Deactivate Olive/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'At least one active super admin must remain.',
    );
  });

  it('deactivates a team member after confirmation', async () => {
    signInAsStaff('SUPER_ADMIN', 1);
    mockStaff();
    let called = false;
    server.use(
      http.post(
        `${A}/staff/20/deactivate/`,
        () => ((called = true), HttpResponse.json(member({ is_active: false }))),
      ),
    );
    renderApp('/admin/staff');
    await userEvent.click(await screen.findByRole('button', { name: /^Deactivate Nia/ }));
    const dialog = await screen.findByRole('dialog');
    expect(called).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(called).toBe(true));
  });
});

describe('generateTemporaryPassword', () => {
  it('always satisfies the server rules', () => {
    for (let i = 0; i < 25; i++) {
      const p = generateTemporaryPassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
    }
  });
});
