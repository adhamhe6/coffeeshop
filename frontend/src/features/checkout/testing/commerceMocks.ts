import { http, HttpResponse } from 'msw';
import type {
  Address,
  AppNotification,
  CartPreview,
  CheckoutPayload,
  Order,
  PaymentMethod,
  PreviewRequest,
  Slot,
} from '@/lib/api';
import type { Cart, CartItem, User } from '@/lib/api/types';
import { state as mockState } from '@/mocks/handlers';

/**
 * In-memory fake of the commerce endpoints for tests. It mimics the server's *contract* (shapes, error codes) but
 * is deliberately simple. Tests flip switches on the returned context to provoke the server behaviours they need.
 */
const API = '/api/v1';
const url = (p: string) => `${API}/${p}`;
const err = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  fields?: Record<string, string[]>,
) =>
  HttpResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}), request_id: 'req-test', ...extra } },
    { status },
  );

export function cartItem(over: Partial<CartItem> & { id: number }): CartItem {
  return {
    quantity: 1,
    unit_price: '4.50',
    line_total: '4.50',
    note: '',
    product: {
      id: over.id,
      slug: `product-${over.id}`,
      name: `Flat white`,
      image: null,
      is_available: true,
    },
    options: [{ group: 'Size', name: 'Large', price_delta: '0.50' }],
    price_changed: null,
    issues: [],
    ...over,
  };
}

export const address = (over: Partial<Address> = {}): Address => ({
  id: 1,
  label: 'Home',
  recipient_name: 'Alex Morgan',
  phone: '+1 555 010 0201',
  line1: '14 Sample Street',
  line2: '',
  city: 'Harbour City',
  postal_code: '00000',
  zone: 1,
  zone_name: 'Old Town',
  instructions: '',
  is_default: true,
  ...over,
});

const PICKUP_STEPS = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED'];
const DELIVERY_STEPS = ['PENDING', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'COMPLETED'];
const LABELS: Record<string, string> = {
  PENDING: 'Order placed',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  OUT_FOR_DELIVERY: 'Out for delivery',
  COMPLETED: 'Completed',
};

export function makeOrder(over: Partial<Order> = {}): Order {
  const type = over.order_type ?? 'PICKUP';
  const status = over.status ?? 'PENDING';
  const steps = type === 'PICKUP' ? PICKUP_STEPS : DELIVERY_STEPS;
  const idx = steps.indexOf(status);
  const timeline =
    status === 'CANCELLED'
      ? [
          {
            status: 'PENDING',
            label: 'Order placed',
            state: 'done' as const,
            at: '2026-10-10T10:00:00Z',
          },
          {
            status: 'CANCELLED',
            label: 'Cancelled',
            state: 'cancelled' as const,
            at: '2026-10-10T10:05:00Z',
          },
        ]
      : steps.map((s, i) => ({
          status: s,
          label: LABELS[s] ?? s,
          state: (i < idx ? 'done' : i === idx ? 'current' : 'upcoming') as
            'done' | 'current' | 'upcoming',
          at: i <= idx ? '2026-10-10T10:00:00Z' : null,
        }));
  return {
    number: 'DT-261010-0001',
    status,
    order_type: type,
    payment_status: 'PAID',
    payment_method: 'demo',
    currency: 'USD',
    subtotal: '9.00',
    discount_total: '0.00',
    delivery_fee: type === 'DELIVERY' ? '2.50' : '0.00',
    tax_total: '0.72',
    tax_rate: '8.00',
    prices_include_tax: false,
    total: type === 'DELIVERY' ? '12.22' : '9.72',
    refunded_total: '0.00',
    coupon_code: '',
    branch: {
      id: 1,
      code: 'OT',
      name: 'Old Town Roastery',
      slug: 'old-town',
      address_line: '12 Cooper Lane',
      city: 'Replace City',
      phone: '+1 555 010 0101',
      timezone: 'UTC',
    },
    items: [
      {
        id: 1,
        product_id: 1,
        product_slug: 'flat-white',
        product_name: 'Flat white',
        sku: 'LC-1',
        image: null,
        quantity: 2,
        base_price: '4.00',
        unit_price: '4.50',
        line_total: '9.00',
        options: [{ group: 'Size', name: 'Large', price_delta: '0.50' }],
      },
    ],
    customer_name: 'Alex Morgan',
    customer_email: 'customer@example.com',
    delivery_address:
      type === 'DELIVERY'
        ? {
            recipient_name: 'Alex Morgan',
            line1: '14 Sample Street',
            city: 'Harbour City',
            zone: 'Old Town',
            instructions: 'Ring the top bell',
          }
        : null,
    requested_for: null,
    estimated_ready_at: '2026-10-10T10:20:00Z',
    customer_notes: '',
    placed_at: '2026-10-10T10:00:00Z',
    payment: {
      status: 'PAID',
      provider: 'demo',
      provider_label: 'Sandbox payment',
      is_sandbox: true,
      action: null,
      failure_message: null,
      can_retry: false,
    },
    history: [
      {
        from_status: '',
        to_status: 'PENDING',
        actor: 'customer',
        note: 'Order placed',
        created_at: '2026-10-10T10:00:00Z',
      },
    ],
    timeline,
    actions: { can_cancel: false, can_pay: false, can_reorder: true, can_review: false },
    ...over,
  };
}

export interface CommerceCtx {
  cart: CartItem[];
  addresses: Address[];
  orders: Record<string, Order>;
  notifications: AppNotification[];
  methods: PaymentMethod[];
  slots: Slot[];
  asapAvailable: boolean;
  /** Every request the fake saw: `{ method, path, body, headers }`. */
  requests: Array<{
    method: string;
    path: string;
    body: unknown;
    headers: Headers;
    search: string;
  }>;
  /** Coupon codes the server accepts, with their percentage. */
  coupons: Record<string, number>;
  /** Total the server computes next; tests change item prices to provoke `price_changed`. */
  priceFactor: number;
  /** Provoke failures on the next `checkout/` calls (consumed in order). */
  checkoutFailures: Array<() => Response>;
  placed: Array<{ key: string; payload: CheckoutPayload }>;
  demoPayments: Record<string, { order: string; status: string }>;
  syncSequence: string[];
  blockers: CartPreview['checkout_blockers'];
  nextOrder: number;
}

export function createCommerceCtx(over: Partial<CommerceCtx> = {}): CommerceCtx {
  return {
    cart: [cartItem({ id: 1, quantity: 2, line_total: '9.00' })],
    addresses: [address()],
    orders: {},
    notifications: [],
    methods: [
      {
        key: 'demo',
        label: 'Sandbox payment',
        description: 'Sandbox payment — no real money moves.',
        is_sandbox: true,
        offline: false,
      },
      {
        key: 'cash',
        label: 'Pay at pickup / on delivery',
        description: '',
        is_sandbox: false,
        offline: true,
      },
    ],
    slots: [
      { starts_at: '2026-10-10T18:00:00Z', label: '6:00 PM' },
      { starts_at: '2026-10-10T18:15:00Z', label: '6:15 PM' },
    ],
    asapAvailable: true,
    requests: [],
    coupons: { SAVE10: 10 },
    priceFactor: 1,
    checkoutFailures: [],
    placed: [],
    demoPayments: {},
    syncSequence: [],
    blockers: [],
    nextOrder: 1,
    ...over,
  };
}

const money = (n: number) => n.toFixed(2);

function cartPayload(ctx: CommerceCtx): Cart {
  const item_count = ctx.cart.reduce((n, i) => n + i.quantity, 0);
  const subtotal = ctx.cart.reduce((n, i) => n + Number(i.line_total), 0);
  return {
    items: ctx.cart,
    item_count,
    subtotal: money(subtotal),
    currency: 'USD',
    issues: [],
    branch_id: null,
  };
}

export function previewFor(ctx: CommerceCtx, req: PreviewRequest): CartPreview {
  const subtotal = ctx.cart.reduce((n, i) => n + Number(i.line_total), 0) * ctx.priceFactor;
  const pct = req.coupon_code ? ctx.coupons[req.coupon_code.toUpperCase()] : undefined;
  const discount = pct ? subtotal * (pct / 100) : 0;
  const delivery = req.order_type === 'DELIVERY' && req.address_id ? 2.5 : 0;
  const tax = (subtotal - discount) * 0.08;
  const blockers = [...ctx.blockers];
  if (!req.branch_id)
    blockers.push({
      code: 'branch_required',
      message: 'Choose a location for your order.',
      severity: 'error',
    });
  if (req.order_type === 'DELIVERY' && !req.address_id)
    blockers.push({
      code: 'address_required',
      message: 'Choose a delivery address.',
      severity: 'error',
    });
  if (req.coupon_code && !pct)
    blockers.push({
      code: 'not_found',
      message: 'That promo code is not valid.',
      severity: 'error',
      data: { field: 'coupon_code' },
    });
  return {
    order_type: req.order_type,
    branch_id: req.branch_id ?? null,
    currency: 'USD',
    items: ctx.cart.map((i) => ({ ...i, discount: '0.00' })),
    item_count: ctx.cart.reduce((n, i) => n + i.quantity, 0),
    subtotal: money(subtotal),
    discount_total: money(discount),
    delivery_fee: money(delivery),
    tax_total: money(tax),
    tax_rate: '8.00',
    tax_label: 'Sales tax',
    prices_include_tax: false,
    total: money(subtotal - discount + delivery + tax),
    coupon: pct
      ? {
          code: req.coupon_code as string,
          name: 'Save',
          discount_type: 'PERCENT',
          discount: money(discount),
          is_automatic: false,
        }
      : null,
    coupon_error:
      req.coupon_code && !pct
        ? { code: 'not_found', message: 'That promo code is not valid.' }
        : null,
    delivery: delivery
      ? { fee: money(delivery), min_order_total: '0.00', eta_minutes: 30, zone: 'Old Town' }
      : null,
    requested_for: req.requested_for ?? null,
    estimated_ready_at: '2026-10-10T10:20:00Z',
    issues: ctx.blockers,
    checkout_blockers: blockers,
    can_checkout: blockers.length === 0,
  };
}

export function commerceHandlers(ctx: CommerceCtx) {
  const log = async (request: Request) => {
    const u = new URL(request.url);
    let body: unknown = null;
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      try {
        body = await request.clone().json();
      } catch {
        body = null;
      }
    }
    ctx.requests.push({
      method: request.method,
      path: u.pathname.replace(`${API}/`, ''),
      body,
      headers: request.headers,
      search: u.search,
    });
    return body;
  };
  const calls = (method: string, path: string | RegExp) =>
    ctx.requests.filter(
      (r) =>
        r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)),
    );
  void calls;

  return [
    http.get(url('cart/'), () => HttpResponse.json(cartPayload(ctx))),
    http.patch(url('cart/items/:id/'), async ({ request, params }) => {
      const body = (await log(request)) as { quantity?: number; note?: string };
      const line = ctx.cart.find((i) => i.id === Number(params.id));
      if (!line) return err(404, 'not_found', 'Not found.');
      if (body.quantity) {
        line.quantity = body.quantity;
        line.line_total = money(body.quantity * Number(line.unit_price));
      }
      if (body.note !== undefined) line.note = body.note;
      return HttpResponse.json(cartPayload(ctx));
    }),
    http.delete(url('cart/items/:id/'), async ({ request, params }) => {
      await log(request);
      ctx.cart = ctx.cart.filter((i) => i.id !== Number(params.id));
      return HttpResponse.json(cartPayload(ctx));
    }),
    http.post(url('cart/acknowledge-prices/'), async ({ request }) => {
      await log(request);
      ctx.cart = ctx.cart.map((i) => ({ ...i, price_changed: null }));
      return HttpResponse.json(cartPayload(ctx));
    }),
    http.post(url('cart/preview/'), async ({ request }) => {
      const body = (await log(request)) as PreviewRequest;
      return HttpResponse.json(previewFor(ctx, body));
    }),
    http.post(url('coupons/validate/'), async ({ request }) => {
      const body = (await log(request)) as { code: string };
      const pct = ctx.coupons[body.code.toUpperCase()];
      if (!pct)
        return err(
          404,
          'not_found',
          'That promo code is not valid.',
          { coupon: body.code },
          { code: ['That promo code is not valid.'] },
        );
      return HttpResponse.json({
        valid: true,
        code: body.code.toUpperCase(),
        name: 'Save',
        discount_type: 'PERCENT',
        value: String(pct),
        discount: '0.90',
        subtotal: '9.00',
        min_order_total: '0.00',
        max_discount: null,
      });
    }),
    http.get(url('payments/methods/'), () => HttpResponse.json(ctx.methods)),
    http.get(url('delivery-zones/'), () =>
      HttpResponse.json([
        { id: 1, slug: 'old-town', name: 'Old Town', branch_slugs: ['old-town'] },
        { id: 2, slug: 'midtown', name: 'Midtown', branch_slugs: ['riverside'] },
      ]),
    ),
    http.get(url('branches/:slug/slots/'), ({ request }) => {
      const date = new URL(request.url).searchParams.get('date') ?? '2026-10-10';
      return HttpResponse.json({
        date,
        timezone: 'UTC',
        asap_available: ctx.asapAvailable,
        asap_eta: '2026-10-10T10:20:00Z',
        unavailable_code: ctx.asapAvailable ? null : 'branch_closed',
        unavailable_message: ctx.asapAvailable ? null : 'This location is closed right now.',
        slots: ctx.slots,
      });
    }),
    http.get(url('addresses/'), () => HttpResponse.json(ctx.addresses)),
    http.post(url('addresses/'), async ({ request }) => {
      const body = (await log(request)) as Partial<Address>;
      const created = address({
        ...body,
        id: 10 + ctx.addresses.length,
        zone_name: 'Old Town',
        is_default: Boolean(body.is_default),
      });
      ctx.addresses = [...ctx.addresses, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(url('addresses/:id/'), async ({ request, params }) => {
      const body = (await log(request)) as Partial<Address>;
      ctx.addresses = ctx.addresses.map((a) =>
        a.id === Number(params.id) ? { ...a, ...body } : a,
      );
      return HttpResponse.json(ctx.addresses.find((a) => a.id === Number(params.id)));
    }),
    http.delete(url('addresses/:id/'), async ({ request, params }) => {
      await log(request);
      ctx.addresses = ctx.addresses.filter((a) => a.id !== Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(url('addresses/:id/set-default/'), async ({ request, params }) => {
      await log(request);
      ctx.addresses = ctx.addresses.map((a) => ({ ...a, is_default: a.id === Number(params.id) }));
      return HttpResponse.json(ctx.addresses.find((a) => a.id === Number(params.id)));
    }),
    http.post(url('checkout/'), async ({ request }) => {
      const payload = (await log(request)) as CheckoutPayload;
      const key = request.headers.get('Idempotency-Key') ?? '';
      const failure = ctx.checkoutFailures.shift();
      if (failure) return failure();
      const replay = ctx.placed.find((p) => p.key === key);
      if (replay) {
        const existing = Object.values(ctx.orders)[0];
        return HttpResponse.json({ order: existing, payment: existing?.payment }, { status: 200 });
      }
      const preview = previewFor(ctx, {
        order_type: payload.order_type,
        branch_id: payload.branch_id,
        address_id: payload.address_id,
        coupon_code: payload.coupon_code,
      });
      if (payload.expected_total && payload.expected_total !== preview.total)
        return err(409, 'price_changed', 'Prices changed since you last reviewed your order.', {
          preview,
        });
      ctx.placed.push({ key, payload });
      const number = `OT-${String(ctx.nextOrder++).padStart(4, '0')}`;
      const reference = `demo_${number}`;
      const online = payload.payment_method !== 'cash';
      const payment = {
        status: online ? 'REQUIRES_ACTION' : 'PENDING',
        provider: payload.payment_method,
        provider_label: online ? 'Sandbox payment' : 'Pay at pickup',
        is_sandbox: online,
        action: online
          ? { type: 'redirect' as const, url: `http://localhost:3000/pay/demo/${reference}` }
          : { type: 'none' as const },
        failure_message: null,
        can_retry: online,
      };
      const order = makeOrder({
        number,
        status: 'PENDING',
        payment_status: online ? 'REQUIRES_ACTION' : 'PENDING',
        payment_method: payload.payment_method,
        order_type: payload.order_type,
        total: preview.total,
        payment,
        actions: { can_cancel: true, can_pay: online, can_reorder: true, can_review: false },
      });
      ctx.orders[number] = order;
      ctx.demoPayments[reference] = { order: number, status: 'REQUIRES_ACTION' };
      ctx.cart = [];
      return HttpResponse.json({ order, payment }, { status: 201 });
    }),
    http.get(url('orders/:number/'), async ({ request, params }) => {
      await log(request);
      const order = ctx.orders[String(params.number)];
      return order ? HttpResponse.json(order) : err(404, 'not_found', 'Not found.');
    }),
    http.get(url('orders/'), ({ request }) => {
      const u = new URL(request.url);
      const statuses = u.searchParams.getAll('status');
      ctx.requests.push({
        method: 'GET',
        path: 'orders/',
        body: null,
        headers: request.headers,
        search: u.search,
      });
      const all = Object.values(ctx.orders).filter(
        (o) => statuses.length === 0 || statuses.includes(o.status),
      );
      return HttpResponse.json({
        count: all.length,
        next: null,
        previous: null,
        results: all.map((o) => ({
          number: o.number,
          status: o.status,
          order_type: o.order_type,
          payment_status: o.payment_status,
          payment_method: o.payment_method,
          currency: 'USD',
          total: o.total,
          branch: o.branch,
          item_count: 2,
          items_preview: ['2 × Flat white'],
          placed_at: o.placed_at,
        })),
      });
    }),
    http.post(url('orders/:number/cancel/'), async ({ request, params }) => {
      await log(request);
      const order = ctx.orders[String(params.number)];
      if (!order) return err(404, 'not_found', 'Not found.');
      const cancelled = makeOrder({
        ...order,
        status: 'CANCELLED',
        actions: { ...order.actions, can_cancel: false, can_pay: false },
        cancel_reason: 'Cancelled by customer',
      });
      ctx.orders[order.number] = cancelled;
      return HttpResponse.json(cancelled);
    }),
    http.post(url('orders/:number/reorder/'), async ({ request }) => {
      await log(request);
      return HttpResponse.json({ cart: cartPayload(ctx), skipped: [] });
    }),
    http.post(url('orders/:number/pay/'), async ({ request, params }) => {
      await log(request);
      const reference = `demo_retry_${String(params.number)}`;
      ctx.demoPayments[reference] = { order: String(params.number), status: 'REQUIRES_ACTION' };
      return HttpResponse.json({
        status: 'REQUIRES_ACTION',
        provider: 'demo',
        provider_label: 'Sandbox payment',
        is_sandbox: true,
        action: { type: 'redirect', url: `/pay/demo/${reference}` },
        failure_message: null,
        can_retry: true,
      });
    }),
    http.post(url('orders/:number/payment/sync/'), async ({ request, params }) => {
      await log(request);
      const status =
        ctx.syncSequence.length > 1
          ? (ctx.syncSequence.shift() as string)
          : (ctx.syncSequence[0] ?? 'PAID');
      return HttpResponse.json({
        order_number: String(params.number),
        order_status: 'PENDING',
        payment: {
          status,
          provider: 'demo',
          provider_label: 'Sandbox payment',
          is_sandbox: true,
          action: null,
          failure_message: null,
          can_retry: status === 'FAILED',
        },
      });
    }),
    http.get(url('payments/demo/:reference/'), ({ params }) => {
      const p = ctx.demoPayments[String(params.reference)];
      if (!p) return err(404, 'not_found', 'Not found.');
      return HttpResponse.json({
        reference: String(params.reference),
        order_number: p.order,
        total: '9.72',
        currency: 'USD',
        items: [{ name: 'Flat white', quantity: 2, line_total: '9.00' }],
        status: p.status,
        order_status: 'PENDING',
        can_complete: p.status === 'REQUIRES_ACTION',
        sandbox: true,
        notice: 'Sandbox payment — no real money moves.',
      });
    }),
    http.post(url('payments/demo/:reference/complete/'), async ({ request, params }) => {
      const body = (await log(request)) as { outcome: string };
      const p = ctx.demoPayments[String(params.reference)];
      if (!p) return err(404, 'not_found', 'Not found.');
      if (p.status !== 'REQUIRES_ACTION')
        return err(
          409,
          'payment_not_pending',
          `This sandbox payment is already ${p.status.toLowerCase()}.`,
        );
      p.status =
        body.outcome === 'success' ? 'PAID' : body.outcome === 'decline' ? 'FAILED' : 'CANCELLED';
      return HttpResponse.json({
        outcome: body.outcome,
        payment_status: p.status,
        order_number: p.order,
        order_status: 'PENDING',
        order_payment_status: p.status,
        can_retry: p.status !== 'PAID',
        sandbox: true,
        event_outcome: 'applied',
      });
    }),
    http.get(url('notifications/'), ({ request }) => {
      const unread = new URL(request.url).searchParams.get('unread');
      const list = unread ? ctx.notifications.filter((n) => !n.is_read) : ctx.notifications;
      return HttpResponse.json({ count: list.length, next: null, previous: null, results: list });
    }),
    http.post(url('notifications/read-all/'), async ({ request }) => {
      await log(request);
      ctx.notifications = ctx.notifications.map((n) => ({ ...n, is_read: true }));
      return HttpResponse.json({ updated: ctx.notifications.length });
    }),
    http.post(url('notifications/:id/read/'), async ({ request, params }) => {
      await log(request);
      ctx.notifications = ctx.notifications.map((n) =>
        n.id === Number(params.id) ? { ...n, is_read: true } : n,
      );
      return HttpResponse.json(ctx.notifications.find((n) => n.id === Number(params.id)));
    }),
    http.patch(url('account/'), async ({ request }) => {
      const body = (await log(request)) as Record<string, unknown>;
      if (body.email && !body.current_password)
        return err(
          400,
          'validation_error',
          'Please correct the highlighted fields.',
          {},
          { current_password: ['Enter your current password to change your email.'] },
        );
      const user = { ...(mockState.me.user as User), ...(body as Partial<User>) };
      mockState.me = { ...mockState.me, user };
      return HttpResponse.json(mockState.me.user);
    }),
    http.post(url('auth/verify-email/'), async ({ request }) => {
      const body = (await log(request)) as { token: string };
      if (body.token !== 'good-token')
        return err(400, 'invalid_token', 'This confirmation link is invalid or has expired.');
      return HttpResponse.json({
        detail: 'Your email address is confirmed.',
        email_verified: true,
      });
    }),
    http.post(url('auth/resend-verification/'), async ({ request }) => {
      await log(request);
      return HttpResponse.json(
        { detail: 'We sent a new confirmation link to your email address.', email_verified: false },
        { status: 202 },
      );
    }),
    http.post(url('account/password/'), async ({ request }) => {
      const body = (await log(request)) as { current_password: string };
      if (body.current_password !== 'old-password-123')
        return err(
          400,
          'validation_error',
          'Please correct the highlighted fields.',
          {},
          { current_password: ['Your current password is incorrect.'] },
        );
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
