import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { state } from '@/mocks/handlers';
import { toggleLocalFavorite } from '@/lib/favoritesStorage';
import { expectNoA11yViolations, renderApp, resetTestWorld, withinMain } from '@/test/utils';

beforeEach(() => resetTestWorld());

async function fillRegister(
  overrides: Partial<Record<'first' | 'last' | 'email' | 'password', string>> = {},
) {
  const v = {
    first: 'Robin',
    last: 'Hale',
    email: 'robin@example.com',
    password: 'a-long-passphrase-1',
    ...overrides,
  };
  await userEvent.type(await screen.findByLabelText(/^First name/), v.first);
  await userEvent.type(screen.getByLabelText(/^Last name/), v.last);
  await userEvent.type(withinMain().getByLabelText(/^Email/), v.email);
  await userEvent.type(screen.getByLabelText(/^Password/), v.password);
}

describe('registration', () => {
  it('has no obvious accessibility violations', async () => {
    const { container } = renderApp('/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    await expectNoA11yViolations(container);
  });

  it('shows live password rules (icon + text) as the user types', async () => {
    renderApp('/register');
    const pw = await screen.findByLabelText(/^Password/);
    expect(screen.getByText(/At least 10 characters/)).toHaveTextContent('not met yet');
    await userEvent.type(pw, 'short');
    expect(screen.getByText(/At least 10 characters/)).toHaveTextContent('not met yet');
    await userEvent.clear(pw);
    await userEvent.type(pw, '1234567890');
    expect(screen.getByText(/At least 10 characters/)).toHaveTextContent('(met)');
    expect(screen.getByText(/Not only numbers/)).toHaveTextContent('not met yet');
    await userEvent.clear(pw);
    await userEvent.type(pw, 'a-long-passphrase-1');
    expect(screen.getByText(/Not only numbers/)).toHaveTextContent('(met)');
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('flags a password containing the email local part', async () => {
    renderApp('/register');
    await userEvent.type(await withinMain().findByLabelText(/^Email/), 'robin@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'robin-is-great-123');
    expect(screen.getByText(/Does not contain your name or email/)).toHaveTextContent(
      'not met yet',
    );
  });

  it('creates the account, merges favourites and redirects', async () => {
    toggleLocalFavorite(6);
    const { router } = renderApp('/register?next=%2Fcheckout');
    await fillRegister();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/checkout'));
    expect(state.me.user?.email).toBe('robin@example.com');
    expect([...state.favorites]).toEqual([6]);
  });

  it('maps field-level server errors onto the fields', async () => {
    renderApp('/register');
    await fillRegister({ email: 'customer@example.com' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const email = withinMain().getByLabelText(/^Email/);
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(email).toHaveAccessibleDescription(/already exists/);
    // Field errors are shown inline; there is no duplicate form-level banner for them.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('validates client-side before submitting', async () => {
    renderApp('/register');
    await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter your first name.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
  });

  it('password visibility toggle exposes pressed state', async () => {
    renderApp('/register');
    const toggle = await screen.findByRole('button', { name: 'Show password' });
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'text');
  });
});

describe('forgot / reset password', () => {
  it('forgot password shows a neutral confirmation', async () => {
    renderApp('/forgot-password');
    await userEvent.type(await withinMain().findByLabelText(/^Email/), 'anyone@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await within(await screen.findByRole('main')).findByRole('status')).toHaveTextContent(
      /If an account exists/,
    );
  });

  it('reset password with a valid token succeeds', async () => {
    renderApp('/reset-password?uid=abc&token=good-token');
    await userEvent.type(await screen.findByLabelText(/^New password/), 'a-long-passphrase-1');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'a-long-passphrase-1');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('reset password with a bad token offers a new link', async () => {
    renderApp('/reset-password?uid=abc&token=bad');
    await userEvent.type(await screen.findByLabelText(/^New password/), 'a-long-passphrase-1');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'a-long-passphrase-1');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/);
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('reset password without uid/token explains the problem', async () => {
    renderApp('/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(/incomplete/);
  });

  it('requires matching passwords', async () => {
    renderApp('/reset-password?uid=abc&token=good-token');
    await userEvent.type(await screen.findByLabelText(/^New password/), 'a-long-passphrase-1');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'different-passphrase-2');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
  });
});
