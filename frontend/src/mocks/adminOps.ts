import { http, HttpResponse } from 'msw';
import type {
  AdminCancelResponse,
  AdminOrderDetail,
  AdminOrderRow,
  AdminQueue,
} from '@/lib/api/adminOrders';
import type { AdminPayment, AdminPaymentDetail } from '@/lib/api/adminPayments';
import type { Dashboard, Definition } from '@/lib/api/adminReports';
import type { MeResponse } from '@/lib/api/types';
import { server } from './server';
import { state } from './handlers';
import { staffMe } from './fixtures';

/** Fixtures + handlers for the operations half of the admin dashboard (overview, orders, payments, reports). */

export const ALL_OPS_CAPS = [
  'dashboard.view',
  'orders.view',
  'orders.manage',
  'orders.cancel',
  'orders.note',
  'payments.view',
  'payments.refund',
  'payments.collect',
  'reports.view',
  'reports.export',
  'inventory.view',
  'customers.view',
  'branches.view',
];

export function signInAsStaff(
  capabilities: string[] = ALL_OPS_CAPS,
  branchIds: number[] | null = null,
  role = 'ADMIN',
) {
  state.me = {
    ...staffMe,
    staff: {
      ...(staffMe.staff as NonNullable<MeResponse['staff']>),
      role,
      capabilities,
      branch_ids: branchIds,
    },
  };
}

const kpi = (value: string | number, previous: string | number | null, delta: number | null) => ({
  value,
  previous,
  delta_pct: delta,
});

export const dashboardFixture = {
  period: {
    date_from: '2026-09-11',
    date_to: '2026-10-10',
    previous_date_from: '2026-08-12',
    previous_date_to: '2026-09-10',
    granularity: 'day',
    branch: null,
    timezones: ['America/New_York'],
  },
  kpis: {
    gross_sales: kpi('1989.60', '1365.60', 45.7),
    discounts: kpi('22.48', '8.83', 154.6),
    delivery_fees: kpi('63.00', '18.00', 250),
    tax: kpi('157.33', '108.53', 45),
    refunds: kpi('12.84', '62.40', -79.4),
    net_sales: kpi('1954.28', '1294.37', 51),
    revenue_collected: kpi('2174.61', '1420.90', 53),
    orders_total: kpi(99, 68, 45.6),
    orders_counted: kpi(91, 62, 46.8),
    orders_completed: kpi(85, 62, 37.1),
    orders_pending: kpi(10, 0, null),
    orders_cancelled: kpi(4, 6, -33.3),
    average_order_value: kpi('21.48', '20.88', 2.9),
    payment_failures: kpi(1, 6, -83.3),
    active_products: kpi(71, null, null),
    low_stock_products: kpi(3, null, null),
    out_of_stock_products: kpi(2, null, null),
  },
  series: [
    {
      bucket: '2026-10-09',
      orders: 6,
      gross_sales: '71.20',
      discounts: '2.00',
      delivery_fees: '0.00',
      tax: '5.52',
      refunds: '0.00',
      net_sales: '69.20',
      revenue_collected: '74.72',
      average_order_value: '11.53',
    },
    {
      bucket: '2026-10-10',
      orders: 8,
      gross_sales: '272.90',
      discounts: '7.44',
      delivery_fees: '7.50',
      tax: '21.24',
      refunds: '0.00',
      net_sales: '265.46',
      revenue_collected: '294.20',
      average_order_value: '33.18',
    },
  ],
  orders_by_status: [
    { status: 'PENDING', label: 'Pending', count: 2, share: 2 },
    { status: 'COMPLETED', label: 'Completed', count: 85, share: 85.9 },
  ],
  category_sales: [
    {
      category: 'Milk Coffee',
      units: 36,
      orders: 31,
      gross: '190.10',
      discounts: '0.00',
      net: '190.10',
      share: 9.7,
    },
  ],
  top_products: {
    by_units: [{ sku: 'LC-0201', product_name: 'Latte', units: 11, revenue: '62.80' }],
    by_revenue: [{ sku: 'LC-0201', product_name: 'Latte', units: 11, revenue: '62.80' }],
  },
  branch_performance: [
    {
      branch_id: 1,
      branch: 'Downtown Flagship',
      timezone: 'America/New_York',
      orders_total: 52,
      orders: 48,
      gross_sales: '1176.90',
      discounts: '10.38',
      refunds: '6.32',
      net_sales: '1160.20',
      revenue_collected: '1298.99',
      average_order_value: '24.17',
    },
    {
      branch_id: 2,
      branch: 'Riverside',
      timezone: 'America/New_York',
      orders_total: 34,
      orders: 31,
      gross_sales: '677.60',
      discounts: '10.38',
      refunds: '4.70',
      net_sales: '662.52',
      revenue_collected: '733.40',
      average_order_value: '21.37',
    },
  ],
  recent_orders: [
    {
      number: 'DT-261010-D006',
      customer: 'Priya R.',
      branch: 'Downtown Flagship',
      total: '44.28',
      status: 'PENDING',
      payment_status: 'REQUIRES_ACTION',
      placed_at: '2026-10-10T21:26:17Z',
    },
  ],
  recent_customers: [{ name: 'Lucía F.', joined_at: '2026-10-10T21:29:26Z' }],
  attention: { stuck_orders: 2, failed_payments: 1, refund_needed: 3, low_stock: 5 },
  generated_at: '2026-10-10T21:32:02Z',
  is_demo_data: true,
} as unknown as Dashboard;

export const definitionsFixture: Definition[] = [
  {
    key: 'gross_sales',
    label: 'Gross sales',
    definition: 'Sum of item line totals of counted orders, before discounts.',
  },
  { key: 'net_sales', label: 'Net sales', definition: 'Gross sales - discounts - refunds.' },
  { key: 'refunds', label: 'Refunds', definition: 'Refunded amount of counted orders.' },
  {
    key: 'discounts',
    label: 'Discounts',
    definition: 'Coupon and automatic discounts on counted orders.',
  },
  { key: 'orders_total', label: 'Orders placed', definition: 'All orders placed in the period.' },
  {
    key: 'average_order_value',
    label: 'Average order value',
    definition: 'Net sales divided by counted orders.',
  },
];

export const branchOptionsFixture = [
  { id: 1, code: 'DT', name: 'Downtown Flagship', slug: 'downtown-flagship', is_active: true },
  { id: 2, code: 'RS', name: 'Riverside', slug: 'riverside', is_active: true },
];

export const orderRow = (over: Partial<AdminOrderRow> = {}): AdminOrderRow =>
  ({
    number: 'DT-261010-D005',
    placed_at: '2026-10-10T21:15:19Z',
    customer_name: 'Lucía Fernández',
    branch: { id: 1, name: 'Downtown Flagship' },
    order_type: 'DELIVERY',
    status: 'CONFIRMED',
    payment_status: 'PAID',
    payment_method: 'demo',
    total: '27.44',
    currency: 'USD',
    item_count: 4,
    age_minutes: 31,
    minutes_in_status: 17,
    is_stuck: false,
    needs_attention: null,
    requested_for: null,
    is_demo: true,
    ...over,
  }) as AdminOrderRow;

export const paymentDetail = (over: Partial<AdminPaymentDetail> = {}): AdminPaymentDetail =>
  ({
    id: 243,
    provider: 'demo',
    provider_label: 'Sandbox (demo, no real money)',
    status: 'PAID',
    amount: '27.44',
    currency: 'USD',
    reference: 'demo_seed_237',
    provider_charge_id: 'ch_demo_seed_237',
    is_sandbox: true,
    failure_code: '',
    failure_message: '',
    flagged_reason: '',
    paid_at: '2026-10-10T21:16:04Z',
    refunded_total: '0.00',
    refundable_amount: '27.44',
    needs_refund: false,
    created_at: '2026-10-10T21:15:21Z',
    updated_at: '2026-10-10T21:16:04Z',
    order: {
      number: 'DT-261010-D005',
      status: 'CONFIRMED',
      payment_status: 'PAID',
      order_type: 'DELIVERY',
      total: '27.44',
      refunded_total: '0.00',
      customer_name: 'Lucía Fernández',
      customer_email: 'lucia@lantern.example',
      branch_id: 1,
      branch_name: 'Downtown Flagship',
    },
    events: [],
    refunds: [],
    can_refund: true,
    provider_is_available: true,
    ...over,
  }) as AdminPaymentDetail;

export const orderDetail = (over: Partial<AdminOrderDetail> = {}): AdminOrderDetail =>
  ({
    ...orderRow(),
    confirmed_at: '2026-10-10T21:18:19Z',
    completed_at: null,
    cancelled_at: null,
    cancel_reason: '',
    estimated_ready_at: null,
    customer_notes: 'Please ring twice',
    delivery_address: {
      recipient_name: 'Lucía Fernández',
      line1: '19 Imaginary Mews',
      city: 'Harbour City',
      postal_code: '00000',
      instructions: 'Gate code 0000',
    },
    delivery_zone_name: 'University District',
    customer: {
      id: 14,
      name: 'Lucía Fernández',
      email: 'lucia@lantern.example',
      phone: '+1 555 010 0206',
    },
    totals: {
      subtotal: '23.20',
      discount_total: '1.96',
      delivery_fee: '4.50',
      tax_total: '1.70',
      tax_rate: '8.00',
      prices_include_tax: false,
      total: '27.44',
      refunded_total: '0.00',
      coupon_code: 'HAPPYHOUR',
    },
    items: [
      {
        id: 1,
        product_name: 'Iced Americano',
        sku: 'LC-0402',
        category_name: 'Iced',
        quantity: 2,
        base_price: '3.90',
        unit_price: '4.40',
        line_total: '8.80',
        discount_amount: '0.44',
        note: 'Extra ice',
        options: [{ group_name: 'Syrup', option_name: 'Brown sugar', price_delta: '0.50' }],
      },
    ],
    payments: [paymentDetail()],
    history: [
      {
        from_status: '',
        to_status: 'PENDING',
        actor_label: 'customer',
        note: 'Order placed',
        created_at: '2026-10-10T21:15:19Z',
      },
    ],
    notes: [],
    allowed_transitions: ['PREPARING', 'CANCELLED'],
    permissions: {
      can_transition: true,
      can_cancel: true,
      can_note: true,
      can_refund: true,
      can_collect_cash: false,
    },
    ...over,
  }) as AdminOrderDetail;

export const queueFixture: AdminQueue = {
  generated_at: '2026-10-10T21:32:06Z',
  branch_ids: null,
  statuses: [
    { status: 'PENDING', label: 'Order placed', count: 1, stuck_count: 0, oldest_age_minutes: 2 },
    { status: 'CONFIRMED', label: 'Confirmed', count: 1, stuck_count: 1, oldest_age_minutes: 25 },
    { status: 'PREPARING', label: 'Preparing', count: 0, stuck_count: 0, oldest_age_minutes: null },
    {
      status: 'READY_FOR_PICKUP',
      label: 'Ready for pickup',
      count: 0,
      stuck_count: 0,
      oldest_age_minutes: null,
    },
    {
      status: 'OUT_FOR_DELIVERY',
      label: 'Out for delivery',
      count: 0,
      stuck_count: 0,
      oldest_age_minutes: null,
    },
  ],
  totals: { active: 2, stuck: 1 },
  stuck_rules_minutes: {},
} as AdminQueue;

export interface RecordedRequest {
  method: string;
  url: URL;
  body?: unknown;
  headers: Headers;
}

/**
 * Registers handlers for every operations endpoint and records what the UI sent. Pass overrides to change a payload;
 * mutable `world` lets tests look at (or change) the "server" state.
 */
export function mockAdminOps(
  opts: {
    order?: AdminOrderDetail;
    cancel?: (body: { reason: string; refund: boolean }) => Response | AdminCancelResponse;
    transition?: (to: string) => Response | AdminOrderDetail;
    refund?: (body: { amount?: string; reason: string }, key: string | null) => Response | object;
    payment?: AdminPaymentDetail;
    payments?: AdminPayment[];
    orders?: AdminOrderRow[];
  } = {},
) {
  const requests: RecordedRequest[] = [];
  const world = { order: opts.order ?? orderDetail(), payment: opts.payment ?? paymentDetail() };
  const record = async (request: Request) => {
    let body: unknown;
    if (request.method !== 'GET')
      body = await request
        .clone()
        .json()
        .catch(() => undefined);
    requests.push({
      method: request.method,
      url: new URL(request.url),
      body,
      headers: request.headers,
    });
    return body;
  };
  const A = '/api/v1/admin';
  server.use(
    http.get(`${A}/dashboard/`, async ({ request }) => {
      await record(request);
      return HttpResponse.json(dashboardFixture);
    }),
    http.get(`${A}/reports/definitions/`, () => HttpResponse.json(definitionsFixture)),
    http.get(`${A}/branches/options/`, () => HttpResponse.json(branchOptionsFixture)),
    http.get(`${A}/reports/sales/`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({
        period: dashboardFixture.period,
        totals: {
          orders: 91,
          gross_sales: '1989.60',
          discounts: '22.48',
          delivery_fees: '63.00',
          tax: '157.33',
          refunds: '12.84',
          net_sales: '1954.28',
          revenue_collected: '2174.61',
          average_order_value: '21.48',
        },
        results: dashboardFixture.series,
      });
    }),
    http.get(`${A}/reports/products/`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        period: dashboardFixture.period,
        totals: { units: 11, orders: 9, gross: '62.80', discounts: '0.00', net: '62.80' },
        results: [
          {
            sku: 'LC-0201',
            product_name: 'Latte',
            category_name: 'Milk Coffee',
            units: 11,
            orders: 9,
            gross: '62.80',
            discounts: '0.00',
            net: '62.80',
            share: 100,
          },
        ],
      });
    }),
    http.get(`${A}/orders/queue/`, async ({ request }) => {
      await record(request);
      return HttpResponse.json(queueFixture);
    }),
    http.get(`${A}/orders/`, async ({ request }) => {
      await record(request);
      const results = opts.orders ?? [
        orderRow({
          status: 'PENDING',
          number: 'DT-261010-D006',
          payment_status: 'REQUIRES_ACTION',
          age_minutes: 4,
          minutes_in_status: 2,
        }),
        orderRow({
          is_stuck: true,
          needs_attention: {
            code: 'confirmed_too_long',
            message: 'Confirmed 25 min ago, still not being prepared.',
          },
        }),
      ];
      return HttpResponse.json({ count: results.length, next: null, previous: null, results });
    }),
    http.get(`${A}/orders/:number/`, async ({ request }) => {
      await record(request);
      return HttpResponse.json(world.order);
    }),
    http.post(`${A}/orders/:number/transition/`, async ({ request }) => {
      const body = (await record(request)) as { to_status: string };
      const out = opts.transition?.(body.to_status);
      if (out instanceof Response) return out;
      world.order = out ?? {
        ...world.order,
        status: body.to_status as AdminOrderDetail['status'],
        allowed_transitions: ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'COMPLETED'].slice(0, 1),
      };
      return HttpResponse.json(world.order);
    }),
    http.post(`${A}/orders/:number/cancel/`, async ({ request }) => {
      const body = (await record(request)) as { reason: string; refund: boolean };
      const out = opts.cancel?.(body);
      if (out instanceof Response) return out;
      const res =
        out ??
        ({
          order: {
            ...world.order,
            status: 'CANCELLED',
            allowed_transitions: [],
            cancel_reason: body.reason,
          },
          refund: {
            status: body.refund ? 'SUCCEEDED' : 'NOT_REQUESTED',
            message: body.refund
              ? 'Refunded 27.44 USD through Sandbox.'
              : 'No refund was requested. The payment, if any, is unchanged.',
            amount: body.refund ? '27.44' : null,
            refund_id: null,
            payment_id: null,
          },
        } as AdminCancelResponse);
      world.order = res.order;
      return HttpResponse.json(res);
    }),
    http.post(`${A}/orders/:number/notes/`, async ({ request }) => {
      const body = (await record(request)) as { body: string };
      world.order = {
        ...world.order,
        notes: [
          ...world.order.notes,
          { id: 1, author: 'Sam Admin', body: body.body, created_at: '2026-10-10T21:40:00Z' },
        ],
      };
      return HttpResponse.json(world.order.notes[0], { status: 201 });
    }),
    http.post(`${A}/orders/:number/collect-cash/`, async ({ request }) => {
      await record(request);
      return HttpResponse.json(world.order);
    }),
    http.get(`${A}/payments/`, async ({ request }) => {
      await record(request);
      const results = opts.payments ?? [world.payment];
      return HttpResponse.json({ count: results.length, next: null, previous: null, results });
    }),
    http.get(`${A}/payments/:id/`, async ({ request }) => {
      await record(request);
      return HttpResponse.json(world.payment);
    }),
    http.post(`${A}/payments/:id/refund/`, async ({ request }) => {
      const body = (await record(request)) as { amount?: string; reason: string };
      const out = opts.refund?.(body, request.headers.get('Idempotency-Key'));
      if (out instanceof Response) return out;
      return HttpResponse.json(
        out ?? {
          refund: {
            id: 1,
            amount: body.amount ?? world.payment.refundable_amount,
            reason: body.reason,
            status: 'SUCCEEDED',
            reference: 're_1',
            failure_message: '',
            initiated_by: 'a@b.c',
            created_at: '2026-10-10T21:50:00Z',
            updated_at: '2026-10-10T21:50:00Z',
          },
          payment: world.payment,
        },
      );
    }),
  );
  return { requests, world };
}

export const apiError = (status: number, code: string, message: string, extra: object = {}) =>
  HttpResponse.json({ error: { code, message, request_id: 'req-test', ...extra } }, { status });
