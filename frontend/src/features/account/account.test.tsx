import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, resetTestWorld } from '@/test/utils';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { customerMe, demoUser } from '@/mocks/fixtures';
import { resetSelectedBranchForTests } from '@/features/catalog/useSelectedBranch';
import { resetSelectionForTests } from '@/features/checkout/selection';
import {
  address,
  commerceHandlers,
  createCommerceCtx,
  makeOrder,
  type CommerceCtx,
} from '@/features/checkout/testing/commerceMocks';

// Pages are lazy chunks: the first render of a cold test file can be slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

let ctx: CommerceCtx;
function setup(over: Parameters<typeof createCommerceCtx>[0] = {}) {
  ctx = createCommerceCtx(over);
  server.use(...commerceHandlers(ctx));
  state.me = { ...customerMe, user: { ...demoUser, phone: '+1 555 010 0201' } };
}
const calls = (method: string, path: string | RegExp) =>
  ctx.requests.filter(
    (r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)),
  );

beforeEach(() => {
  resetTestWorld();
  resetSelectedBranchForTests();
  resetSelectionForTests();
});

describe('protected account routes', () => {
  it('sends signed-out visitors to /login with a return path', async () => {
    setup();
    state.me = { authenticated: false, user: null, staff: null, unread_notifications: 0 };
    const { router } = renderApp('/account/orders');
    await screen.findByRole('heading', { name: 'Welcome back' }, { timeout: 4000 });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Faccount%2Forders');
  });
});

describe('profile', () => {
  it('saves name, phone and the marketing preference', async () => {
    setup();
    renderApp('/account');
    const user = userEvent.setup();
    const first = await screen.findByLabelText(/First name/);
    await user.clear(first);
    await user.type(first, 'Alexandra');
    await user.clear(screen.getByLabelText(/^Phone/));
    await user.type(screen.getByLabelText(/^Phone/), '+1 555 010 9999');
    await user.click(screen.getByRole('switch', { name: /News about new roasts/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('PATCH', 'account/')).toHaveLength(1));
    expect(calls('PATCH', 'account/')[0]?.body).toEqual({
      first_name: 'Alexandra',
      last_name: 'Morgan',
      phone: '+1 555 010 9999',
      marketing_opt_in: true,
    });
    expect(await screen.findByText('Your profile was saved.')).toBeInTheDocument();
  });

  it('asks for the current password before an email change and sends it with the new email', async () => {
    setup();
    renderApp('/account');
    const user = userEvent.setup();
    expect(screen.queryByLabelText(/Current password/)).not.toBeInTheDocument();
    const profile = await screen.findByRole('form', { name: 'Profile details' });
    const email = within(profile).getByLabelText(/^Email/);
    await user.clear(email);
    await user.type(email, 'new@example.com');
    await user.click(within(profile).getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Enter your current password to change your email address.'),
    ).toBeInTheDocument();
    expect(calls('PATCH', 'account/')).toHaveLength(0);

    await user.type(within(profile).getByLabelText(/Current password/), 'old-password-123');
    await user.click(within(profile).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('PATCH', 'account/')).toHaveLength(1));
    expect(calls('PATCH', 'account/')[0]?.body).toMatchObject({
      email: 'new@example.com',
      current_password: 'old-password-123',
    });
  });
});

describe('change password', () => {
  it('checks the confirmation locally and shows a wrong current password from the server', async () => {
    setup();
    renderApp('/account');
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Change password' });
    await user.type(within(form).getByLabelText(/^Current password/), 'wrong-password');
    await user.type(within(form).getByLabelText(/^New password/), 'A-new-passphrase-77');
    await user.type(within(form).getByLabelText(/Confirm new password/), 'different-passphrase');
    await user.click(within(form).getByRole('button', { name: 'Change password' }));
    expect(await within(form).findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(calls('POST', 'account/password/')).toHaveLength(0);

    await user.clear(within(form).getByLabelText(/Confirm new password/));
    await user.type(within(form).getByLabelText(/Confirm new password/), 'A-new-passphrase-77');
    await user.click(within(form).getByRole('button', { name: 'Change password' }));
    expect(
      await within(form).findByText('Your current password is incorrect.'),
    ).toBeInTheDocument();
  });

  it('changes the password and clears the form', async () => {
    setup();
    renderApp('/account');
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Change password' });
    await user.type(within(form).getByLabelText(/^Current password/), 'old-password-123');
    await user.type(within(form).getByLabelText(/^New password/), 'A-new-passphrase-77');
    await user.type(within(form).getByLabelText(/Confirm new password/), 'A-new-passphrase-77');
    await user.click(within(form).getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your password was changed.')).toBeInTheDocument();
    expect(calls('POST', 'account/password/')[0]?.body).toEqual({
      current_password: 'old-password-123',
      new_password: 'A-new-passphrase-77',
    });
    expect(within(form).getByLabelText(/^Current password/)).toHaveValue('');
  });
});

describe('sign out', () => {
  it('ends the session and returns to the home page', async () => {
    setup();
    const { router } = renderApp('/account');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(state.me.authenticated).toBe(false);
    expect(await screen.findByText('You have been signed out.')).toBeInTheDocument();
  });
});

describe('addresses', () => {
  const two = () => [
    address({ id: 1, label: 'Home', is_default: true }),
    address({
      id: 2,
      label: 'Office',
      line1: '200 Plaza',
      is_default: false,
      zone: 2,
      zone_name: 'Midtown',
    }),
  ];

  it('lists addresses with their delivery area and default marker', async () => {
    setup({ addresses: two() });
    renderApp('/account/addresses');
    const cards = await screen.findAllByTestId('address-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Default');
    expect(cards[1]).toHaveTextContent('Midtown');
  });

  it('adds an address with a zone', async () => {
    setup({ addresses: [] });
    renderApp('/account/addresses');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add address' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an address' });
    await user.type(within(dialog).getByLabelText(/Street address/), '9 New Road');
    await user.type(within(dialog).getByLabelText(/^City/), 'Harbour City');
    await user.click(within(dialog).getByRole('combobox', { name: /Delivery area/ }));
    await user.click(await screen.findByRole('option', { name: 'Midtown' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add address' }));
    await waitFor(() => expect(calls('POST', 'addresses/')).toHaveLength(1));
    expect(calls('POST', 'addresses/')[0]?.body).toMatchObject({
      line1: '9 New Road',
      zone: 2,
      is_default: true,
    });
    expect(await screen.findByText('Address saved.')).toBeInTheDocument();
  });

  it('validates required fields before sending', async () => {
    setup({ addresses: [] });
    renderApp('/account/addresses');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add address' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add address' }));
    expect(await within(dialog).findByText('Enter the street address.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose your delivery area.')).toBeInTheDocument();
    expect(calls('POST', 'addresses/')).toHaveLength(0);
  });

  it('edits, makes default and deletes (after confirmation)', async () => {
    setup({ addresses: two() });
    renderApp('/account/addresses');
    const user = userEvent.setup();
    await screen.findAllByTestId('address-card');

    await user.click(screen.getByRole('button', { name: 'Edit Office' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit address' });
    const line = within(dialog).getByLabelText(/Street address/);
    await user.clear(line);
    await user.type(line, '201 Plaza');
    await user.click(within(dialog).getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(calls('PATCH', 'addresses/2/')).toHaveLength(1));
    expect(calls('PATCH', 'addresses/2/')[0]?.body).toMatchObject({ line1: '201 Plaza', zone: 2 });

    await user.click(await screen.findByRole('button', { name: /Make Office the default/ }));
    await waitFor(() => expect(calls('POST', 'addresses/2/set-default/')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Delete Home' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this address?' });
    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(calls('DELETE', 'addresses/1/')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete Home' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete address' }),
    );
    await waitFor(() => expect(calls('DELETE', 'addresses/1/')).toHaveLength(1));
  });
});

describe('order history', () => {
  const orders = () => [
    makeOrder({ number: 'OT-10', status: 'PREPARING' }),
    makeOrder({ number: 'OT-11', status: 'COMPLETED' }),
    makeOrder({ number: 'OT-12', status: 'CANCELLED' }),
  ];

  it('lists orders with status and total, and links to tracking', async () => {
    setup();
    for (const o of orders()) ctx.orders[o.number] = o;
    renderApp('/account/orders');
    const cards = await screen.findAllByTestId('order-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('OT-10');
    expect(cards[0]).toHaveTextContent('Preparing');
    expect(cards[0]).toHaveTextContent('$9.72');
    expect(
      within(cards[0] as HTMLElement).getByRole('link', { name: 'View order OT-10' }),
    ).toHaveAttribute('href', '/orders/OT-10');
  });

  it('filters by status through the server', async () => {
    setup();
    for (const o of orders()) ctx.orders[o.number] = o;
    renderApp('/account/orders');
    const user = userEvent.setup();
    await screen.findAllByTestId('order-card');
    await user.click(screen.getByRole('button', { name: 'Cancelled' }));
    await waitFor(() => expect(screen.getAllByTestId('order-card')).toHaveLength(1));
    expect(screen.getByTestId('order-card')).toHaveTextContent('OT-12');
    const last = calls('GET', 'orders/').pop();
    expect(last?.search).toContain('status=CANCELLED');
    await user.click(screen.getByRole('button', { name: 'In progress' }));
    await waitFor(() =>
      expect(calls('GET', 'orders/').pop()?.search).toContain('status=PENDING&status=CONFIRMED'),
    );
  });

  it('shows an empty state with a way forward when there are no orders', async () => {
    setup();
    renderApp('/account/orders');
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the menu' })).toBeInTheDocument();
  });

  it('reorders into the cart', async () => {
    setup();
    for (const o of orders()) ctx.orders[o.number] = o;
    renderApp('/account/orders');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Order OT-11 again' }));
    expect(await screen.findByRole('heading', { name: 'Your cart' })).toBeInTheDocument();
    expect(calls('POST', 'orders/OT-11/reorder/')).toHaveLength(1);
  });
});

describe('notifications', () => {
  const notes = () => [
    {
      id: 1,
      kind: 'order_confirmed',
      title: 'Order OT-10 confirmed',
      body: 'Downtown has accepted your order.',
      is_read: false,
      order_number: 'OT-10',
      created_at: '2026-10-10T10:00:00Z',
    },
    {
      id: 2,
      kind: 'order_placed',
      title: 'Order OT-9 placed',
      body: 'Thanks.',
      is_read: true,
      order_number: 'OT-9',
      created_at: '2026-10-09T10:00:00Z',
    },
  ];

  it('lists notifications, marks one read when opened and goes to its order', async () => {
    setup({ notifications: notes() });
    ctx.orders['OT-10'] = makeOrder({ number: 'OT-10', status: 'CONFIRMED' });
    const { router } = renderApp('/account/notifications');
    const user = userEvent.setup();
    const list = await screen.findByRole('list', { name: 'Notifications' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText(/Unread:/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /Order OT-10 confirmed/ }));
    await waitFor(() => expect(calls('POST', 'notifications/1/read/')).toHaveLength(1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders/OT-10'));
  });

  it('marks everything as read', async () => {
    setup({ notifications: notes() });
    renderApp('/account/notifications');
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Notifications' });
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(calls('POST', 'notifications/read-all/')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/Unread:/)).not.toBeInTheDocument());
  });

  it('the header bell shows the unread badge and opens a popover with the latest items', async () => {
    window.innerWidth = 1280;
    setup({ notifications: notes() });
    state.me = { ...state.me, unread_notifications: 1 };
    renderApp('/menu');
    const user = userEvent.setup();
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await user.click(bell);
    const popover = await screen.findByRole('dialog');
    expect(await within(popover).findByText('Order OT-10 confirmed')).toBeInTheDocument();
    expect(within(popover).getByRole('link', { name: 'View all notifications' })).toHaveAttribute(
      'href',
      '/account/notifications',
    );
  });
});

describe('email confirmation', () => {
  it('flags an unconfirmed address on the profile and can resend the link', async () => {
    setup();
    state.me = {
      ...customerMe,
      user: { ...demoUser, email_verified: false },
    };
    renderApp('/account');
    const user = userEvent.setup();
    expect(await screen.findByText(/Please confirm customer@example.com/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send the link again' }));
    await waitFor(() => expect(calls('POST', 'auth/resend-verification/')).toHaveLength(1));
    expect(await screen.findByText(/We sent a new confirmation link/)).toBeInTheDocument();
  });

  it('shows a confirmed address quietly', async () => {
    setup();
    state.me = { ...customerMe, user: { ...demoUser, email_verified: true } };
    renderApp('/account');
    expect(await screen.findByText('Email address confirmed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send the link again' })).not.toBeInTheDocument();
  });

  it('the emailed link confirms the address, even when signed out', async () => {
    setup();
    state.me = { authenticated: false, user: null, staff: null, unread_notifications: 0 };
    renderApp('/verify-email?token=good-token');
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Your email address is confirmed' },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(calls('POST', 'auth/verify-email/')[0]?.body).toEqual({ token: 'good-token' });
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('explains a bad or expired link', async () => {
    setup();
    renderApp('/verify-email?token=stale');
    expect(
      await screen.findByRole(
        'heading',
        { name: 'We could not confirm your email' },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
  });

  it('handles a link without a token', async () => {
    setup();
    renderApp('/verify-email');
    expect(
      await screen.findByRole('heading', { name: 'This link is incomplete' }, { timeout: 4000 }),
    ).toBeInTheDocument();
  });
});
