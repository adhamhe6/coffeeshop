import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import * as fx from '@/mocks/fixtures';
import { FAVORITES_KEY } from '@/lib/favoritesStorage';
import { expectNoA11yViolations, renderApp, resetTestWorld } from '@/test/utils';
import { BRANCH_KEY, resetSelectedBranchForTests } from './useSelectedBranch';
import {
  cartLine,
  installCatalogMocks,
  shotsGroup,
  sizeGroup,
  toppingGroup,
} from './testing/catalogMocks';

// Each test boots the real route table and lazy page chunks; give slower machines room.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 6000 });

beforeEach(() => {
  resetTestWorld();
  resetSelectedBranchForTests();
});

const addButton = () => screen.findByRole('button', { name: /^(Add to cart|Update cart item)/ });

describe('product page customiser', () => {
  it('preselects defaults and asks the server for the price (configuration only, never a price)', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    renderApp('/p/flat-white');

    expect(await screen.findByRole('heading', { level: 1, name: 'Flat White' })).toBeVisible();
    // Required group preselected with its default; first quote uses the default branch (first active one).
    expect(await screen.findByRole('radio', { name: 'Small' })).toBeChecked();
    await waitFor(() => expect(rec.quotes.length).toBeGreaterThan(0));
    expect(rec.quotes[0]).toEqual({ option_ids: [1, 3], quantity: 1, branch_id: 1 });

    await user.click(screen.getByRole('radio', { name: /Large/ }));
    const breakdown = await screen.findByLabelText('Price breakdown');
    await waitFor(() => expect(within(breakdown).getAllByText('$5.25').length).toBe(2)); // price each + total
    expect(within(breakdown).getByText(/Large/)).toBeInTheDocument();
    expect(rec.quotes.at(-1)).toEqual({ option_ids: [2, 3], quantity: 1, branch_id: 1 });
    for (const q of rec.quotes) {
      expect(Object.keys(q).sort()).toEqual(['branch_id', 'option_ids', 'quantity']);
    }
  });

  it('adds to the cart with ONLY product_id, option_ids, quantity (and note when written) — never a price', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    renderApp('/p/flat-white');
    await user.click(await screen.findByRole('radio', { name: /Large/ }));
    await user.click(screen.getByRole('checkbox', { name: /Espresso shot/ }));
    await user.click(screen.getByRole('button', { name: 'Increase quantity of Flat White' }));
    await user.type(screen.getByLabelText(/^Note/), 'Extra hot');

    await user.click(await addButton());

    await waitFor(() => expect(rec.cartPosts).toHaveLength(1));
    expect(rec.cartPosts[0]).toEqual({
      product_id: 1,
      quantity: 2,
      option_ids: [2, 3, 5],
      note: 'Extra hot',
    });
    expect(await screen.findByText(/Added 2 × Flat White to your cart/)).toBeInTheDocument();
    // header cart badge follows the server cart
    expect(await screen.findByLabelText('Cart, 2 items')).toBeInTheDocument();
  });

  it('omits the note when empty', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    renderApp('/p/flat-white');
    await user.click(await addButton());
    await waitFor(() => expect(rec.cartPosts).toHaveLength(1));
    expect(Object.keys(rec.cartPosts[0] ?? {}).sort()).toEqual([
      'option_ids',
      'product_id',
      'quantity',
    ]);
  });

  it('disables Add to cart with an explanation while a required group is unsatisfied, and enforces the maximum', async () => {
    installCatalogMocks({ groups: [sizeGroup, shotsGroup, toppingGroup] });
    const user = userEvent.setup();
    renderApp('/p/flat-white');
    const cocoa = await screen.findByRole('checkbox', { name: /Cocoa/ });
    expect(cocoa).toBeChecked(); // required group starts satisfied

    await user.click(cocoa); // un-choose it
    const add = await addButton();
    expect(add).toBeDisabled();
    expect(screen.getAllByText('Choose an option for Topping.').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('checkbox', { name: /Cinnamon/ }));
    await waitFor(() => expect(add).toBeEnabled());

    // Extra shots allow 2: the third option becomes unavailable with a hint
    await user.click(screen.getByRole('checkbox', { name: /Espresso shot/ }));
    await user.click(screen.getByRole('checkbox', { name: /Ristretto shot/ }));
    const third = screen.getByRole('checkbox', { name: /Decaf shot/ });
    expect(third).toBeDisabled();
    expect(screen.getByText('Maximum of 2 reached')).toBeInTheDocument();
  });

  it('blocks adding when the server quote says the configuration is invalid', async () => {
    installCatalogMocks();
    server.use(
      http.post('/api/v1/products/:slug/quote/', () =>
        HttpResponse.json({
          base_price: '4.50',
          unit_price: '4.50',
          quantity: 1,
          options: [],
          line_total: '4.50',
          currency: 'USD',
          valid: false,
          errors: [{ code: 'option_unavailable', message: 'Oat milk just ran out.' }],
        }),
      ),
    );
    renderApp('/p/flat-white');
    const add = await addButton();
    await waitFor(() => expect(add).toBeDisabled());
    expect(screen.getAllByText('Oat milk just ran out.').length).toBeGreaterThan(0);
  });

  it('surfaces a server rejection and keeps the form usable', async () => {
    installCatalogMocks();
    server.use(
      http.post('/api/v1/cart/items/', () =>
        HttpResponse.json(
          { error: { code: 'out_of_stock', message: 'Only 1 left today.', request_id: 'r' } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/p/flat-white');
    await user.click(await addButton());
    expect((await screen.findAllByText('Only 1 left today.')).length).toBeGreaterThan(0);
    expect(await addButton()).toBeEnabled();
  });

  it('shows "Unavailable at <branch>" and blocks adding when the product is not sold there', async () => {
    installCatalogMocks();
    server.use(
      http.get('/api/v1/products/:slug/', ({ params }) => {
        const detail = fx.productDetail(String(params.slug));
        return HttpResponse.json({
          ...detail,
          is_available: false,
          unavailable_reason: 'branch_unavailable',
        });
      }),
    );
    renderApp('/p/flat-white');
    expect((await screen.findAllByText(/Unavailable at Old Town Roastery/)).length).toBeGreaterThan(
      0,
    );
    expect(await addButton()).toBeDisabled();
  });

  it('edit mode (?edit=<cartItemId>) preloads the line and PATCHes instead of POSTing', async () => {
    const rec = installCatalogMocks();
    state.cart = [cartLine()];
    const user = userEvent.setup();
    const { router } = renderApp('/p/flat-white?edit=5');

    expect(await screen.findByRole('radio', { name: /Large/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Oat milk/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Espresso shot/ })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Quantity of Flat White' })).toHaveValue('2');
    expect(screen.getByLabelText(/^Note/)).toHaveValue('Extra hot');

    await user.click(screen.getByRole('radio', { name: /Small/ }));
    await user.click(await screen.findByRole('button', { name: /^Update cart item/ }));

    await waitFor(() => expect(rec.cartPatches).toHaveLength(1));
    expect(rec.cartPatches[0]).toEqual({
      id: 5,
      body: { quantity: 2, option_ids: [1, 4, 5], note: 'Extra hot' },
    });
    expect(rec.cartPosts).toHaveLength(0);
    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'));
  });

  it('edit mode falls back to a normal add when the cart line is gone', async () => {
    installCatalogMocks();
    renderApp('/p/flat-white?edit=99');
    expect(await screen.findByText(/no longer in your cart/)).toBeInTheDocument();
    expect(await addButton()).toHaveTextContent('Add to cart');
  });

  it('sends the selected branch with the detail request', async () => {
    const rec = installCatalogMocks();
    window.localStorage.setItem(
      BRANCH_KEY,
      JSON.stringify({ slug: 'riverside', orderType: 'pickup' }),
    );
    renderApp('/p/flat-white');
    await screen.findByRole('heading', { level: 1, name: 'Flat White' });
    expect(rec.detailQueries.at(-1)?.get('branch')).toBe('riverside');
  });
});

describe('menu filters and URL state', () => {
  it('reads filters from the URL, sends them to the API, and shows removable chips', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    const { router } = renderApp('/menu?type=BEANS&min_price=5');

    const chip = await screen.findByRole(
      'button',
      { name: 'Remove filter: Coffee beans' },
      { timeout: 4000 },
    );
    expect(screen.getByRole('button', { name: 'Remove filter: From $5.00' })).toBeInTheDocument();
    await waitFor(() => {
      const last = rec.productQueries.at(-1);
      expect(last?.get('type')).toBe('BEANS');
      expect(last?.get('min_price')).toBe('5');
    });

    await user.click(chip);
    await waitFor(() => expect(router.state.location.search).toBe('?min_price=5'));
  });

  it('writes filter changes to the URL (and resets paging), and "Clear all" empties it', async () => {
    installCatalogMocks();
    const user = userEvent.setup();
    const { router } = renderApp('/menu?type=BEANS&page=2&ordering=price');

    await screen.findByRole('button', { name: 'Remove filter: Coffee beans' });
    await user.click(screen.getByRole('checkbox', { name: 'Seasonal' }));
    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('seasonal')).toBe('true');
      expect(params.get('type')).toBe('BEANS');
      expect(params.get('ordering')).toBe('price');
      expect(params.has('page')).toBe(false);
    });

    await user.click(screen.getAllByRole('button', { name: 'Clear all' })[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toBe('?ordering=price'));
  });

  it('applies a price range from the form and validates min ≤ max', async () => {
    installCatalogMocks();
    const user = userEvent.setup();
    const { router } = renderApp('/menu?seasonal=true');
    await screen.findByRole('button', { name: 'Remove filter: Seasonal' });
    const aside = screen.getByRole('complementary', { name: 'Filters' });
    await user.type(within(aside).getByLabelText('Min price'), '9');
    await user.type(within(aside).getByLabelText('Max price'), '4');
    await user.click(within(aside).getByRole('button', { name: 'Apply price' }));
    expect(await within(aside).findByText(/minimum price cannot be higher/)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?seasonal=true');

    await user.clear(within(aside).getByLabelText('Max price'));
    await user.type(within(aside).getByLabelText('Max price'), '12.5');
    await user.click(within(aside).getByRole('button', { name: 'Apply price' }));
    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('min_price')).toBe('9');
      expect(params.get('max_price')).toBe('12.5');
    });
  });

  it('category pages load that category and keep the other filters in the rail links', async () => {
    const rec = installCatalogMocks();
    renderApp('/menu/espresso-bar?seasonal=true');
    expect(await screen.findByRole('heading', { level: 1, name: 'Espresso Bar' })).toBeVisible();
    await waitFor(() => expect(rec.productQueries.at(-1)?.get('category')).toBe('espresso-bar'));
    expect(screen.getByRole('link', { name: /Whole Bean Coffee/ })).toHaveAttribute(
      'href',
      '/menu/whole-bean?seasonal=true',
    );
  });

  it('the all-menu overview is sectioned by category with "See all" links', async () => {
    installCatalogMocks();
    renderApp('/menu');
    expect(await screen.findByRole('heading', { level: 2, name: 'Espresso Bar' })).toBeVisible();
    expect(screen.getByRole('link', { name: /See all 6/ })).toHaveAttribute(
      'href',
      '/menu/espresso-bar',
    );
  });
});

describe('search', () => {
  it('shows a no-results state with a way out: clear search, popular categories', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    const { router } = renderApp('/search?q=zzzz');
    expect(await screen.findByRole('heading', { name: 'No results for “zzzz”' })).toBeVisible();
    expect(rec.productQueries.some((p) => p.get('q') === 'zzzz')).toBe(true);
    const popular = screen.getByRole('heading', { name: 'Popular categories' }).closest('section');
    expect(
      within(popular as HTMLElement).getByRole('link', { name: 'Espresso Bar' }),
    ).toHaveAttribute('href', '/menu/espresso-bar');

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('offers "Clear filters" when filters (not the query) cause the empty result', async () => {
    installCatalogMocks();
    const user = userEvent.setup();
    const { router } = renderApp('/menu?type=GIFT');
    expect(
      await screen.findByRole('heading', { name: 'Nothing matches those filters' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('searches with the query in the URL and defaults to relevance ordering', async () => {
    const rec = installCatalogMocks();
    renderApp('/search?q=flat');
    expect(await screen.findByRole('link', { name: 'Flat White' })).toBeVisible();
    expect(rec.productQueries.at(-1)?.get('q')).toBe('flat');
    expect(rec.productQueries.at(-1)?.has('ordering')).toBe(false); // server defaults to relevance
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Best match');
  });
});

describe('branch selection', () => {
  it('passes the selected branch to catalogue requests and labels unavailable items', async () => {
    const rec = installCatalogMocks({ unavailableAt: { riverside: ['cold-brew'] } });
    window.localStorage.setItem(
      BRANCH_KEY,
      JSON.stringify({ slug: 'riverside', orderType: 'pickup' }),
    );
    const user = userEvent.setup();
    renderApp('/menu?bestseller=true');

    expect(await screen.findByText('Unavailable at Riverside')).toBeInTheDocument();
    expect(rec.productQueries.every((p) => p.get('branch') === 'riverside')).toBe(true);

    // switch branch from the header control
    await user.click(screen.getAllByRole('button', { name: /Change branch/ })[0] as HTMLElement);
    await user.click(await screen.findByRole('radio', { name: /Old Town Roastery/ }));
    await waitFor(() => expect(rec.productQueries.at(-1)?.get('branch')).toBe('old-town'));
    await waitFor(() => expect(screen.queryByText(/Unavailable at/)).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(BRANCH_KEY) ?? '{}').slug).toBe('old-town');
  });

  it('defaults to the first active branch and falls back to pickup where delivery is not offered', async () => {
    installCatalogMocks();
    window.localStorage.setItem(BRANCH_KEY, JSON.stringify({ slug: null, orderType: 'delivery' }));
    const user = userEvent.setup();
    renderApp('/menu?bestseller=true');
    const trigger = (
      await screen.findAllByRole('button', { name: /Change branch/ })
    )[0] as HTMLElement;
    expect(trigger).toHaveAccessibleName(/Ordering Old Town Roastery, delivery/);

    await user.click(trigger);
    await user.click(await screen.findByRole('radio', { name: /Riverside/ }));
    // Riverside has no delivery in the fixtures → preference falls back to pickup
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Change branch/ })[0]).toHaveAccessibleName(
        /Ordering Riverside, pickup/,
      ),
    );
    expect(screen.getByRole('radio', { name: 'Delivery' })).toBeDisabled();
  });

  it('survives unavailable storage (in-memory fallback)', async () => {
    installCatalogMocks();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      const user = userEvent.setup();
      renderApp('/menu?bestseller=true');
      await user.click(
        (await screen.findAllByRole('button', { name: /Change branch/ }))[0] as HTMLElement,
      );
      await user.click(await screen.findByRole('radio', { name: /Riverside/ }));
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: /Change branch/ })[0]).toHaveAccessibleName(
          /Riverside/,
        ),
      );
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('product cards', () => {
  it('quick-adds products without options in one tap (no price in the body)', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    renderApp('/menu/bakery');
    await user.click(await screen.findByRole('button', { name: 'Add Butter Croissant to cart' }));
    await waitFor(() => expect(rec.cartPosts).toHaveLength(1));
    expect(rec.cartPosts[0]).toEqual({ product_id: 12, quantity: 1, option_ids: [] });
    expect(await screen.findByText(/Added Butter Croissant to your cart/)).toBeInTheDocument();
  });

  it('opens the customise dialog for products with options instead of adding blindly', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    renderApp('/menu/espresso-bar');
    await user.click(await screen.findByRole('button', { name: 'Customise Flat White' }));
    const dialog = await screen.findByRole('dialog', { name: 'Customise Flat White' });
    expect(rec.cartPosts).toHaveLength(0);
    expect(await within(dialog).findByRole('radio', { name: 'Small' })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: /Large/ }));
    await user.click(await within(dialog).findByRole('button', { name: /^Add to cart/ }));
    await waitFor(() => expect(rec.cartPosts).toHaveLength(1));
    expect(rec.cartPosts[0]).toEqual({ product_id: 1, quantity: 1, option_ids: [2, 3] });
  });
});

describe('favourites', () => {
  it('anonymous visitors save to localStorage without calling the API', async () => {
    const rec = installCatalogMocks();
    const user = userEvent.setup();
    renderApp('/menu?bestseller=true');
    const heart = await screen.findByRole('button', { name: 'Save Flat White to favorites' });
    await user.click(heart);
    expect(
      await screen.findByRole('button', { name: 'Remove Flat White from favorites' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([1]);
    expect(rec.favoritePosts).toHaveLength(0);
    // first save tells them how to keep favourites across devices
    expect(await screen.findByText(/Sign in to keep your favorites/)).toBeInTheDocument();
  });

  it('signed-in customers toggle through the API, optimistically, and can undo', async () => {
    const rec = installCatalogMocks();
    state.me = fx.customerMe;
    const user = userEvent.setup();
    renderApp('/menu?bestseller=true');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull());
    await user.click(await screen.findByRole('button', { name: 'Save Flat White to favorites' }));
    await waitFor(() => expect(rec.favoritePosts).toEqual([{ product_id: 1 }]));
    const pressed = await screen.findByRole('button', { name: 'Remove Flat White from favorites' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(FAVORITES_KEY)).toBeNull();

    await user.click(pressed);
    await waitFor(() => expect(rec.favoriteDeletes).toEqual([1]));
  });

  it('rolls back and reports when the API rejects a toggle', async () => {
    installCatalogMocks();
    state.me = fx.customerMe;
    server.use(
      http.post('/api/v1/favorites/', () =>
        HttpResponse.json(
          { error: { code: 'x', message: 'nope', request_id: 'r' } },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/menu?bestseller=true');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull());
    await user.click(await screen.findByRole('button', { name: 'Save Flat White to favorites' }));
    expect(await screen.findByText(/could not update your favorites/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Save Flat White to favorites' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('favorites page resolves anonymous ids through the API, nudges sign-in and removes items', async () => {
    const rec = installCatalogMocks();
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([1, 12]));
    const user = userEvent.setup();
    renderApp('/favorites');
    expect(await screen.findByRole('link', { name: 'Flat White' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Butter Croissant' })).toBeVisible();
    expect(rec.productQueries.at(-1)?.get('ids')).toBe('1,12');
    expect(screen.getByText('Saved on this device only.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Ffavorites',
    );

    const remove = screen.getAllByRole('button', { name: 'Remove Flat White from favorites' });
    await user.click(remove[remove.length - 1] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Flat White' })).toBeNull());
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([12]);
  });

  it('favorites page shows an empty state with the next step', async () => {
    installCatalogMocks();
    renderApp('/favorites');
    expect(await screen.findByRole('heading', { name: 'No favorites yet' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse the menu' })).toHaveAttribute('href', '/menu');
  });
});

describe('reviews', () => {
  it('labels demo reviews and shows the write form only when the API says the customer may review', async () => {
    const rec = installCatalogMocks({ eligibility: { can_review: true, reason: null } });
    state.me = fx.customerMe;
    const user = userEvent.setup();
    renderApp('/p/flat-white');

    const reviews = await screen.findByRole('region', { name: 'Reviews' });
    expect(await within(reviews).findByText('Perfect')).toBeInTheDocument();
    expect(within(reviews).getAllByText('Demo review')).toHaveLength(1); // only the demo one
    expect(within(reviews).getByText('Verified purchase')).toBeInTheDocument();

    await within(reviews).findByRole('heading', { name: 'Write a review' });
    // rating is required
    await user.click(within(reviews).getByRole('button', { name: 'Submit review' }));
    expect(await within(reviews).findByText('Choose a star rating.')).toBeInTheDocument();
    expect(rec.reviewPosts).toHaveLength(0);

    await user.click(within(reviews).getByRole('radio', { name: '4 stars' }));
    await user.type(within(reviews).getByLabelText('Headline'), 'Lovely');
    await user.type(within(reviews).getByLabelText('Your review'), 'Smooth and balanced.');
    await user.click(within(reviews).getByRole('button', { name: 'Submit review' }));

    await waitFor(() => expect(rec.reviewPosts).toHaveLength(1));
    expect(rec.reviewPosts[0]).toEqual({
      rating: 4,
      title: 'Lovely',
      body: 'Smooth and balanced.',
    });
    expect(await within(reviews).findByText(/awaiting moderation/)).toBeInTheDocument();
    expect(within(reviews).queryByRole('heading', { name: 'Write a review' })).toBeNull();
  });

  it.each([
    ['login_required', /Sign in to write a review/],
    ['not_purchased', /open to customers who have received this item/],
    ['already_reviewed', /already reviewed this product/],
  ])('hides the form and explains why when not eligible (%s)', async (reason, text) => {
    installCatalogMocks({ eligibility: { can_review: false, reason } });
    renderApp('/p/flat-white');
    const reviews = await screen.findByRole('region', { name: 'Reviews' });
    expect(await within(reviews).findByText(text)).toBeInTheDocument();
    expect(within(reviews).queryByRole('heading', { name: 'Write a review' })).toBeNull();
  });
});

describe('locations and contact', () => {
  it('"Order pickup here" selects that branch and goes to the menu', async () => {
    installCatalogMocks();
    const user = userEvent.setup();
    const { router } = renderApp('/locations');
    await user.click(
      await screen.findByRole(
        'button',
        { name: 'Order pickup here at Riverside' },
        { timeout: 4000 },
      ),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/menu'));
    expect(JSON.parse(window.localStorage.getItem(BRANCH_KEY) ?? '{}')).toEqual({
      slug: 'riverside',
      orderType: 'pickup',
    });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Change branch/ })[0]).toHaveAccessibleName(
        /Ordering Riverside, pickup/,
      ),
    );
  });

  it('lists hours, open state and delivery availability; paused branches cannot be ordered from', async () => {
    server.use(
      http.get('/api/v1/branches/', () =>
        HttpResponse.json([
          { ...fx.branches[0], accepting_orders: false, is_open_now: false },
          fx.branches[1],
        ]),
      ),
    );
    renderApp('/locations');
    expect(await screen.findByRole('heading', { name: 'Old Town Roastery' })).toBeVisible();
    expect(screen.getByText('Orders paused')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Order pickup here at Old Town Roastery' }),
    ).toBeDisabled();
    expect(screen.getByText('No delivery')).toBeInTheDocument(); // Riverside
    expect(screen.getAllByText('Opening hours').length).toBe(2);
  });

  it('contact page shows real support details with mailto/tel links and no fake form', async () => {
    renderApp('/contact');
    const mail = await screen.findAllByRole('link', { name: 'hello@lantern.example' });
    expect(mail[0]).toHaveAttribute('href', expect.stringMatching(/^mailto:hello@lantern.example/));
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: '+1 555 010 0100' }),
    ).toHaveAttribute('href', 'tel:+15550100100');
    expect(within(screen.getByRole('main')).queryByRole('textbox')).toBeNull();
  });
});

describe('accessibility', () => {
  it('product page has no axe violations and one h1', async () => {
    installCatalogMocks();
    const { container } = renderApp('/p/flat-white');
    await screen.findByRole('heading', { level: 1, name: 'Flat White' });
    await screen.findByRole('radio', { name: 'Small' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await expectNoA11yViolations(container);
  });

  it('menu overview and filtered grid have no axe violations', async () => {
    installCatalogMocks();
    const { container } = renderApp('/menu?type=BEANS');
    await screen.findByRole('button', { name: /Remove filter/ });
    await screen.findByRole('link', { name: 'House Blend, 250 g' });
    await expectNoA11yViolations(container);
  });

  it('locations page has no axe violations', async () => {
    installCatalogMocks();
    const { container } = renderApp('/locations');
    await screen.findByRole('heading', { name: 'Old Town Roastery' });
    await expectNoA11yViolations(container);
  });
});
