import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { adminNavFor } from '@/features/admin/nav.test-helpers';
import { expectNoA11yViolations, renderApp, resetTestWorld } from '@/test/utils';

beforeEach(() => resetTestWorld());

describe('home page', () => {
  it('renders the CMS hero, editorial sections and real CTAs', async () => {
    renderApp('/');
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Coffee worth slowing down for.');
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('link', { name: /Order for pickup/ })).toHaveAttribute(
      'href',
      '/menu',
    );
    expect(
      await within(main).findByRole('heading', { name: 'Drinks we keep coming back to' }),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole('heading', { name: 'Every drink, built your way' }),
    ).toBeInTheDocument();
    expect(
      within(main).getByRole('heading', { name: 'A roastery with the lights on' }),
    ).toBeInTheDocument();
    expect(
      await within(main).findByRole('heading', { name: 'Find your Lantern' }),
    ).toBeInTheDocument();
    // categories link to real routes
    expect(await within(main).findByRole('link', { name: /Espresso Bar/ })).toHaveAttribute(
      'href',
      '/menu/espresso-bar',
    );
    // seasonal band only appears when seasonal products exist
    expect(
      await within(main).findByRole('heading', { name: 'The season, in a cup' }),
    ).toBeInTheDocument();
  });

  it('has a single h1 and no obvious accessibility violations', async () => {
    const { container } = renderApp('/');
    await screen.findByRole('heading', { name: 'Find your Lantern' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await expectNoA11yViolations(container);
  });

  it('degrades gracefully: static copy when CMS blocks are missing, no seasonal band when nothing is seasonal', async () => {
    server.use(
      http.get('/api/v1/content/blocks/', () => HttpResponse.json({})),
      http.get('/api/v1/products/', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('seasonal'))
          return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      }),
      http.get('/api/v1/categories/', () => HttpResponse.json([])),
    );
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Coffee worth slowing down for.',
    );
    expect(await screen.findByText('The menu is being prepared')).toBeInTheDocument();
    expect(screen.queryByText('The season, in a cup')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'A roastery with the lights on' }),
    ).toBeInTheDocument(); // static fallback copy
  });

  it('shows an error state with retry when the product API fails', async () => {
    let fail = true;
    server.use(
      http.get('/api/v1/products/', ({ request }) => {
        const featured = new URL(request.url).searchParams.get('featured');
        if (featured && fail)
          return HttpResponse.json(
            { error: { code: 'server_error', message: 'Upstream down', request_id: 'r1' } },
            { status: 500 },
          );
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [] });
      }),
    );
    renderApp('/');
    const alert = await screen.findByText('Upstream down', {}, { timeout: 5000 });
    expect(alert).toBeInTheDocument();
    fail = false;
    await userEvent.click(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', {
        name: /try again/i,
      }),
    );
    await waitFor(() => expect(screen.queryByText('Upstream down')).not.toBeInTheDocument());
  });
});

describe('storefront shell', () => {
  it('renders announcement, skip link, primary nav, footer with legal + social links', async () => {
    renderApp('/menu');
    expect(
      await screen.findByText('Free pastry with any beans order this week'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main',
    );
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Menu', 'Seasonal', 'Beans', 'Locations', 'About']);
    const footer = screen.getByRole('contentinfo');
    expect(
      await within(footer).findByRole('link', { name: /Instagram.*opens in a new tab/ }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(await within(footer).findByText('Old Town Roastery')).toBeInTheDocument();
  });

  it('renders social links only when active (absent from the API payload = not rendered)', async () => {
    server.use(
      http.get('/api/v1/store/', () =>
        HttpResponse.json({
          brand_name: 'Lantern Coffee Roasters',
          tagline: 't',
          currency: 'USD',
          social: [],
        }),
      ),
    );
    renderApp('/menu');
    const footer = await screen.findByRole('contentinfo');
    await within(footer).findByText('Old Town Roastery');
    expect(within(footer).queryByLabelText('Social media')).not.toBeInTheDocument();
  });

  it('marks the active primary nav item with aria-current', async () => {
    renderApp('/menu?seasonal=true');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Seasonal' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Menu' })).not.toHaveAttribute('aria-current');
  });

  it('shows the 404 page for unknown routes', async () => {
    renderApp('/definitely/not/a/page');
    expect(
      await screen.findByRole('heading', { name: /could not find that page/i }),
    ).toBeInTheDocument();
    expect(document.title).toMatch(/Page not found/);
  });

  it('the menu route renders the real catalogue page', async () => {
    renderApp('/menu');
    expect(
      await screen.findByRole('heading', { level: 1, name: /Drinks, bakes/ }),
    ).toBeInTheDocument();
  });

  it('moves focus to <main> after client-side navigation', async () => {
    renderApp('/menu');
    await screen.findByRole('heading', { level: 1, name: /Drinks, bakes/ });
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'Locations',
      }),
    );
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  it('the newsletter form posts to the API and confirms', async () => {
    renderApp('/menu');
    const footer = await screen.findByRole('contentinfo');
    await userEvent.type(within(footer).getByLabelText('Email address'), 'reader@example.com');
    await userEvent.click(within(footer).getByRole('button', { name: 'Subscribe' }));
    expect(await within(footer).findByRole('status')).toHaveTextContent(/on the list/);
    expect(state.newsletter).toEqual(['reader@example.com']);
  });

  it('the newsletter form shows API field errors', async () => {
    renderApp('/menu');
    const footer = await screen.findByRole('contentinfo');
    await userEvent.type(within(footer).getByLabelText('Email address'), 'not-an-email');
    await userEvent.click(within(footer).getByRole('button', { name: 'Subscribe' }));
    expect(await within(footer).findByText('Enter a valid email address.')).toBeInTheDocument();
  });
});

describe('search autocomplete', () => {
  it('suggests products from products/suggest/ and navigates with the keyboard', async () => {
    const { router } = renderApp('/menu');
    const input = await screen.findByRole('combobox', { name: 'Search products' });
    await userEvent.type(input, 'flat');
    const list = await screen.findByRole('listbox', { name: 'Search suggestions' });
    expect(await within(list).findByRole('option', { name: /Flat White/ })).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBeTruthy());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/flat-white'));
  });

  it('Enter without a highlighted option searches the typed query; Escape closes the list', async () => {
    const { router } = renderApp('/menu');
    const input = await screen.findByRole('combobox', { name: 'Search products' });
    await userEvent.type(input, 'oat');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
    expect(router.state.location.search).toBe('?q=oat');
  });
});

describe('cart + favourites in the header', () => {
  it('shows the live cart count in the accessible name and opens the cart sheet on desktop', async () => {
    state.cart = [
      {
        id: 1,
        quantity: 2,
        unit_price: '4.50',
        line_total: '9.00',
        note: '',
        product: { id: 1, slug: 'flat-white', name: 'Flat White', image: null, is_available: true },
        options: [{ group: 'Milk', name: 'Oat', price_delta: '0.60' }],
        issues: [],
        price_changed: null,
      },
    ];
    renderApp('/menu');
    const button = await screen.findByRole('button', { name: 'Cart, 2 items' });
    await userEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Your cart' });
    expect(within(sheet).getByText('Flat White')).toBeInTheDocument();
    expect(within(sheet).getByText('Oat')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Checkout' })).toHaveAttribute(
      'href',
      '/checkout',
    );
    // changing the quantity updates the badge optimistically
    await userEvent.click(
      within(sheet).getByRole('button', { name: 'Increase quantity of Flat White' }),
    );
    // (the open dialog hides the page behind it from the a11y tree, hence `hidden: true`)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Cart, 3 items', hidden: true }),
      ).toBeInTheDocument(),
    );
  });

  it('on small screens the cart is a link to /cart', async () => {
    window.innerWidth = 390;
    renderApp('/menu');
    expect(await screen.findByRole('link', { name: 'Cart, empty' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });

  it('an empty cart sheet offers a way back to the menu', async () => {
    renderApp('/menu');
    await userEvent.click(await screen.findByRole('button', { name: 'Cart, empty' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your cart' });
    expect(await within(sheet).findByText('Your cart is empty')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Browse the menu' })).toHaveAttribute(
      'href',
      '/menu',
    );
  });

  it('favourites: anonymous toggles persist to localStorage and update the header count', async () => {
    renderApp('/');
    const card = (
      await screen.findAllByRole('button', { name: 'Save Flat White to favorites' })
    )[0] as HTMLElement;
    await userEvent.click(card);
    expect(await screen.findByRole('link', { name: 'Favorites, 1 saved' })).toHaveAttribute(
      'href',
      '/favorites',
    );
    expect(JSON.parse(window.localStorage.getItem('lantern.favorites.v1') ?? '[]')).toEqual([1]);
    expect(
      screen.getAllByRole('button', { name: 'Remove Flat White from favorites' })[0],
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('favourites: signed-in toggles go to the API optimistically', async () => {
    state.me = (await import('@/mocks/fixtures')).customerMe;
    renderApp('/');
    const btn = (
      await screen.findAllByRole('button', { name: 'Save Flat White to favorites' })
    )[0] as HTMLElement;
    await act(async () => {
      await userEvent.click(btn);
    });
    await waitFor(() => expect(state.favorites.has(1)).toBe(true));
    expect(
      (await screen.findAllByRole('button', { name: 'Remove Flat White from favorites' }))[0],
    ).toBeInTheDocument();
  });
});

describe('admin shell', () => {
  it('shows only the navigation the staff capabilities allow', async () => {
    state.me = (await import('@/mocks/fixtures')).staffMe;
    (await import('@/mocks/adminOps')).mockAdminOps();
    renderApp('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Admin' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual(
      adminNavFor([
        'dashboard.view',
        'orders.view',
        'catalog.view',
        'catalog.manage',
        'settings.manage',
      ]),
    );
    expect(labels).toContain('Orders');
    expect(labels).not.toContain('Staff');
    expect(labels).not.toContain('Audit log');
  });

  it('blocks direct URL access to sections the role lacks', async () => {
    state.me = (await import('@/mocks/fixtures')).staffMe;
    renderApp('/admin/staff');
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument();
  });

  it('renders permitted sections inside the admin theme', async () => {
    state.me = (await import('@/mocks/fixtures')).staffMe;
    (await import('@/mocks/adminOps')).mockAdminOps();
    const { container } = renderApp('/admin/orders');
    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(container.querySelector('[data-theme="admin"]')).not.toBeNull();
  });
});
