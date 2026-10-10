import { http, HttpResponse, delay } from 'msw';
import type { AddCartItemPayload, Cart, CartItem, MeResponse } from '@/lib/api/types';
import * as fx from './fixtures';

/** Mutable in-memory "server". Tests call `resetMockState()` between cases. */
export const state = {
  me: fx.anonymousMe as MeResponse,
  favorites: new Set<number>(),
  cart: [] as CartItem[],
  nextLine: 1,
  newsletter: [] as string[],
  latency: 0,
};

export function resetMockState() {
  state.me = fx.anonymousMe;
  state.favorites = new Set();
  state.cart = [];
  state.nextLine = 1;
  state.newsletter = [];
}

const API = '/api/v1';
const url = (path: string) => `${API}/${path}`;
const err = (status: number, code: string, message: string, fields?: Record<string, string[]>) =>
  HttpResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}), request_id: 'req-mock' } },
    { status },
  );

function setCsrfCookie() {
  if (typeof document !== 'undefined' && !document.cookie.includes('lantern_csrftoken=')) {
    document.cookie = 'lantern_csrftoken=mock-csrf-token; path=/';
  }
}
function requireCsrf(request: Request) {
  return request.headers.get('X-CSRFToken') === 'mock-csrf-token';
}

function cartPayload(): Cart {
  const item_count = state.cart.reduce((n, i) => n + i.quantity, 0);
  const subtotal = state.cart.reduce((n, i) => n + Number(i.line_total), 0).toFixed(2);
  return { items: state.cart, item_count, subtotal, currency: 'USD', issues: [], branch_id: null };
}

function filterProducts(params: URLSearchParams) {
  let list = [...fx.products];
  const bool = (k: string) => params.get(k) === 'true' || params.get(k) === '1';
  if (bool('featured')) list = list.filter((x) => x.flags?.is_featured);
  if (bool('bestseller')) list = list.filter((x) => x.flags?.is_bestseller);
  if (bool('seasonal')) list = list.filter((x) => x.flags?.is_seasonal);
  if (bool('new')) list = list.filter((x) => x.flags?.is_new);
  const type = params.get('type');
  if (type) list = list.filter((x) => x.product_type === type);
  const category = params.get('category');
  if (category) list = list.filter((x) => x.category?.slug === category);
  const q = params.get('q')?.toLowerCase();
  if (q) list = list.filter((x) => x.name.toLowerCase().includes(q));
  return list;
}

export const handlers = [
  http.get(url('store/'), () => HttpResponse.json(fx.store)),
  http.get(url('content/blocks/'), () => HttpResponse.json(fx.blocks)),
  http.get(url('content/pages/:slug/'), ({ params }) =>
    HttpResponse.json({
      slug: params.slug,
      title: String(params.slug),
      summary: '',
      body_markdown: '# Hello\n\nMock page.',
      updated_at: new Date().toISOString(),
    }),
  ),
  http.post(url('newsletter/subscribe/'), async ({ request }) => {
    const { email } = (await request.json()) as { email?: string };
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      return err(400, 'validation_error', 'Please correct the highlighted fields.', {
        email: ['Enter a valid email address.'],
      });
    state.newsletter.push(email);
    return HttpResponse.json({ detail: 'Thanks! You are on the list.' }, { status: 202 });
  }),

  http.get(url('categories/'), () => HttpResponse.json(fx.categories)),
  http.get(url('products/'), async ({ request }) => {
    await delay(state.latency);
    const params = new URL(request.url).searchParams;
    const list = filterProducts(params);
    const size = Number(params.get('page_size') ?? 20);
    const page = Number(params.get('page') ?? 1);
    return HttpResponse.json({
      count: list.length,
      next: null,
      previous: null,
      results: list.slice((page - 1) * size, page * size),
    });
  }),
  http.get(url('products/suggest/'), ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();
    if (q.length < 2) return HttpResponse.json([]);
    return HttpResponse.json(
      fx.products
        .filter((x) => x.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map(({ slug, name, image, category, base_price }) => ({
          slug,
          name,
          image,
          category,
          base_price,
        })),
    );
  }),
  http.get(url('products/:slug/'), ({ params }) => {
    const detail = fx.productDetail(String(params.slug));
    return detail ? HttpResponse.json(detail) : err(404, 'not_found', 'Not found.');
  }),
  http.get(url('collections/'), () => HttpResponse.json(fx.collections)),
  http.get(url('collections/:slug/'), ({ params }) => {
    const c = fx.collections.find((x) => x.slug === params.slug);
    return c
      ? HttpResponse.json({ ...c, products: fx.products.filter((x) => x.flags?.is_seasonal) })
      : err(404, 'not_found', 'Not found.');
  }),
  http.get(url('branches/'), () => HttpResponse.json(fx.branches)),
  http.get(url('branches/:slug/'), ({ params }) => {
    const b = fx.branches.find((x) => x.slug === params.slug);
    return b ? HttpResponse.json(b) : err(404, 'not_found', 'Not found.');
  }),

  // ── auth ──
  http.get(url('auth/csrf/'), () => {
    setCsrfCookie();
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(url('auth/me/'), () => HttpResponse.json(state.me)),
  http.post(url('auth/login/'), async ({ request }) => {
    if (!requireCsrf(request)) return err(403, 'permission_denied', 'CSRF Failed: token missing.');
    const body = (await request.json()) as { email?: string; password?: string };
    await delay(state.latency);
    if (body.email?.toLowerCase() === 'admin@example.com' && body.password === fx.DEMO_PASSWORD) {
      state.me = fx.staffMe;
      return HttpResponse.json(state.me);
    }
    if (body.email?.toLowerCase() === fx.demoUser.email && body.password === fx.DEMO_PASSWORD) {
      state.me = fx.customerMe;
      return HttpResponse.json(state.me);
    }
    return err(400, 'invalid_credentials', 'That email and password do not match an account.');
  }),
  http.post(url('auth/register/'), async ({ request }) => {
    if (!requireCsrf(request)) return err(403, 'permission_denied', 'CSRF Failed: token missing.');
    const body = (await request.json()) as Record<string, string>;
    const fields: Record<string, string[]> = {};
    if (body.email === fx.demoUser.email)
      fields.email = ['An account with this email already exists.'];
    if ((body.password ?? '').length < 10)
      fields.password = ['This password is too short. It must contain at least 10 characters.'];
    if (Object.keys(fields).length)
      return err(400, 'validation_error', 'Please correct the highlighted fields.', fields);
    const user = {
      ...fx.demoUser,
      id: 99,
      email: body.email as string,
      first_name: body.first_name as string,
      last_name: body.last_name as string,
    };
    state.me = { authenticated: true, user, staff: null, unread_notifications: 0 };
    return HttpResponse.json(user, { status: 201 });
  }),
  http.post(url('auth/logout/'), () => {
    state.me = fx.anonymousMe;
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(url('auth/password-reset/'), () =>
    HttpResponse.json(
      { detail: 'If an account exists for that email, a reset link is on its way.' },
      { status: 202 },
    ),
  ),
  http.post(url('auth/password-reset/confirm/'), async ({ request }) => {
    const body = (await request.json()) as { token?: string; new_password?: string };
    if (body.token !== 'good-token')
      return err(400, 'invalid_token', 'This reset link is invalid or has expired.');
    if ((body.new_password ?? '').length < 10)
      return err(400, 'validation_error', 'Please correct the highlighted fields.', {
        new_password: ['This password is too short. It must contain at least 10 characters.'],
      });
    return HttpResponse.json({ detail: 'Your password has been updated. You can now sign in.' });
  }),

  // ── favorites ──
  http.get(url('favorites/ids/'), () => HttpResponse.json({ ids: [...state.favorites] })),
  http.post(url('favorites/'), async ({ request }) => {
    const { product_id } = (await request.json()) as { product_id: number };
    state.favorites.add(product_id);
    return HttpResponse.json({ product_id }, { status: 201 });
  }),
  http.delete(url('favorites/:id/'), ({ params }) => {
    state.favorites.delete(Number(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(url('favorites/merge/'), async ({ request }) => {
    const { product_ids } = (await request.json()) as { product_ids: number[] };
    let added = 0;
    for (const id of product_ids) {
      if (!state.favorites.has(id)) {
        state.favorites.add(id);
        added++;
      }
    }
    return HttpResponse.json({ added, ids: [...state.favorites] });
  }),

  // ── cart ──
  http.get(url('cart/'), () => HttpResponse.json(cartPayload())),
  http.post(url('cart/items/'), async ({ request }) => {
    const body = (await request.json()) as AddCartItemPayload;
    const product = fx.products.find((x) => x.id === body.product_id);
    if (!product) return err(404, 'not_found', 'Product not found.');
    const existing = state.cart.find((i) => i.product.id === product.id);
    if (existing) {
      existing.quantity += body.quantity;
      existing.line_total = (existing.quantity * Number(existing.unit_price)).toFixed(2);
    } else {
      state.cart.push({
        id: state.nextLine++,
        quantity: body.quantity,
        unit_price: product.base_price,
        line_total: (body.quantity * Number(product.base_price)).toFixed(2),
        note: body.note ?? '',
        product: {
          id: product.id,
          slug: product.slug,
          name: product.name,
          image: product.image,
          is_available: true,
        },
        options: [],
        issues: [],
        price_changed: null,
      });
    }
    return HttpResponse.json(cartPayload(), { status: 201 });
  }),
  http.patch(url('cart/items/:id/'), async ({ params, request }) => {
    const { quantity } = (await request.json()) as { quantity?: number };
    const line = state.cart.find((i) => i.id === Number(params.id));
    if (!line) return err(404, 'not_found', 'Not found.');
    if (quantity) {
      line.quantity = quantity;
      line.line_total = (quantity * Number(line.unit_price)).toFixed(2);
    }
    return HttpResponse.json(cartPayload());
  }),
  http.delete(url('cart/items/:id/'), ({ params }) => {
    state.cart = state.cart.filter((i) => i.id !== Number(params.id));
    return HttpResponse.json(cartPayload());
  }),
  http.delete(url('cart/'), () => {
    state.cart = [];
    return new HttpResponse(null, { status: 204 });
  }),
];
