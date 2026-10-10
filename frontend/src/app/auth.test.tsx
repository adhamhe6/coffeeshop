import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { DEMO_PASSWORD } from '@/mocks/fixtures';
import { state } from '@/mocks/handlers';
import { toggleLocalFavorite } from '@/lib/favoritesStorage';
import { onUnauthorized } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';
import { expectNoA11yViolations, renderApp, resetTestWorld, withinMain } from '@/test/utils';

beforeEach(() => resetTestWorld());

async function fillLogin(email: string, password: string) {
  await userEvent.type(await withinMain().findByLabelText(/^Email/), email);
  await userEvent.type(screen.getByLabelText(/^Password/), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('login flow', () => {
  it('has no obvious accessibility violations', async () => {
    const { container } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Welcome back' });
    await expectNoA11yViolations(container);
  });

  it('shows client-side validation errors without calling the API', async () => {
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(withinMain().getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('signs in, merges anonymous favourites, and redirects to ?next', async () => {
    toggleLocalFavorite(1);
    toggleLocalFavorite(2);
    const { router, client } = renderApp('/login?next=%2Faccount%2Forders');
    await fillLogin('customer@example.com', DEMO_PASSWORD);
    await waitFor(() => expect(router.state.location.pathname).toBe('/account/orders'));
    expect(client.getQueryData<{ authenticated: boolean }>(qk.auth.me)?.authenticated).toBe(true);
    expect([...state.favorites].sort()).toEqual([1, 2]); // merged on the server
    expect(window.localStorage.getItem('lantern.favorites.v1')).toBeNull(); // local copy cleared
  });

  it('shows the server error for bad credentials and stays on the page', async () => {
    const { router } = renderApp('/login');
    await fillLogin('customer@example.com', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match an account');
    expect(router.state.location.pathname).toBe('/login');
  });

  it('ignores unsafe next targets (open-redirect protection)', async () => {
    const { router } = renderApp('/login?next=https%3A%2F%2Fevil.example');
    await fillLogin('customer@example.com', DEMO_PASSWORD);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toBe('');
  });

  it('staff users see the admin link in the account menu', async () => {
    renderApp('/login');
    await fillLogin('admin@example.com', DEMO_PASSWORD);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument(),
    );
    await userEvent.click(await screen.findByRole('button', { name: /Account menu for Sam/ }));
    expect(await screen.findByRole('menuitem', { name: /Admin dashboard/ })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});

describe('route guards', () => {
  it('redirects anonymous visitors from /account to /login?next=', async () => {
    const { router } = renderApp('/account');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Faccount');
  });

  it('redirects anonymous visitors from /admin to /login', async () => {
    const { router } = renderApp('/admin/orders');
    // The admin layout is a lazy chunk: allow for a slow first import on a loaded machine.
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'), { timeout: 5000 });
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Forders');
  });

  it('shows a forbidden message to signed-in customers who are not staff', async () => {
    state.me = (await import('@/mocks/fixtures')).customerMe;
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument();
  });

  it('a global 401 clears the session and bounces a protected page to /login', async () => {
    state.me = (await import('@/mocks/fixtures')).customerMe;
    server.use(http.get('/api/v1/auth/me/', () => HttpResponse.json(state.me)));
    const { router, client } = renderApp('/account');
    // Signed in: the profile page renders.
    expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    // Any API call now answers 401 → the app must treat the session as gone.
    state.me = (await import('@/mocks/fixtures')).anonymousMe;
    const { api } = await import('@/lib/api/client');
    server.use(
      http.get('/api/v1/orders/', () =>
        HttpResponse.json(
          { error: { code: 'not_authenticated', message: 'Sign in.' } },
          { status: 401 },
        ),
      ),
    );
    await api.get('orders/').catch(() => undefined);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(client.getQueryData<{ authenticated: boolean }>(qk.auth.me)?.authenticated).toBe(false);
    expect(router.state.location.search).toBe('?next=%2Faccount');
  });

  it('unauthorized events are unsubscribed on unmount', () => {
    const off = onUnauthorized(() => undefined);
    expect(typeof off).toBe('function');
    off();
  });
});

describe('logout', () => {
  it('signs out from the account menu and returns to anonymous state', async () => {
    state.me = (await import('@/mocks/fixtures')).customerMe;
    renderApp('/menu');
    await userEvent.click(await screen.findByRole('button', { name: /Account menu for Alex/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Sign out/ }));
    await waitFor(() => expect(state.me.authenticated).toBe(false));
    expect(await screen.findByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });
});
