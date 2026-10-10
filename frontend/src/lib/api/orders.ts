import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { createBackoff } from '../polling';
import { api } from './client';
import { qk } from './keys';
import type { Cart, Paginated } from './types';

/** Customer-facing order payloads (`orders/`, `checkout/`). Money values are decimal strings. */
export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'CANCELLED';
export type OrderType = 'PICKUP' | 'DELIVERY';
export type PaymentStatus =
  | 'PENDING'
  | 'REQUIRES_ACTION'
  | 'AUTHORIZED'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

/** Order page refresh cadence (ms). An object so tests can shorten it. */
export const orderPolling = { baseMs: 10_000, maxMs: 60_000 };

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];
export const isTerminalOrder = (status: string | undefined) =>
  status === 'COMPLETED' || status === 'CANCELLED';

export interface PaymentAction {
  type: 'redirect' | 'none';
  url?: string;
}

export interface PaymentInfo {
  status: PaymentStatus | string;
  provider: string;
  provider_label: string;
  is_sandbox: boolean;
  action: PaymentAction | null;
  failure_message: string | null;
  can_retry: boolean;
  error?: { code: string; message: string } | null;
}

export interface OrderBranch {
  id: number;
  code: string;
  name: string;
  slug: string;
  address_line: string;
  city: string;
  phone: string;
  timezone: string;
}

export interface OrderLineOption {
  group: string;
  name: string;
  price_delta?: string;
}

export interface OrderLine {
  id: number;
  product_id: number | null;
  product_slug: string | null;
  product_name: string;
  sku: string;
  category_name?: string;
  image: string | null;
  quantity: number;
  base_price: string;
  unit_price: string;
  line_total: string;
  discount_amount?: string;
  note?: string;
  options: OrderLineOption[];
}

export interface DeliveryAddressSnapshot {
  recipient_name?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  postal_code?: string;
  zone?: string;
  zone_id?: number;
  instructions?: string;
}

export interface TimelineStep {
  status: string;
  label: string;
  state: 'done' | 'current' | 'upcoming' | 'cancelled';
  at: string | null;
}

export interface OrderHistoryEntry {
  from_status: string;
  to_status: string;
  actor: 'customer' | 'system' | 'staff';
  note: string;
  created_at: string;
}

export interface OrderActions {
  can_cancel: boolean;
  can_pay: boolean;
  can_reorder: boolean;
  can_review: boolean;
}

export interface Order {
  number: string;
  status: OrderStatus;
  order_type: OrderType;
  payment_status: PaymentStatus;
  payment_method: string;
  currency: string;
  subtotal: string;
  discount_total?: string;
  delivery_fee?: string;
  tax_total?: string;
  tax_rate?: string;
  prices_include_tax?: boolean;
  total: string;
  refunded_total?: string;
  coupon_code?: string;
  branch: OrderBranch;
  items: OrderLine[];
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  delivery_address?: DeliveryAddressSnapshot | null;
  delivery_zone_name?: string;
  requested_for?: string | null;
  estimated_ready_at?: string | null;
  customer_notes?: string;
  placed_at: string;
  confirmed_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string;
  is_demo?: boolean;
  payment: PaymentInfo;
  history: OrderHistoryEntry[];
  timeline: TimelineStep[];
  actions: OrderActions;
}

export interface OrderSummary {
  number: string;
  status: OrderStatus;
  order_type: OrderType;
  payment_status: PaymentStatus;
  payment_method: string;
  currency: string;
  total: string;
  branch: OrderBranch;
  item_count: number;
  items_preview: string[];
  requested_for?: string | null;
  estimated_ready_at?: string | null;
  placed_at: string;
  is_demo?: boolean;
}

export interface PaymentSync {
  order_number: string;
  order_status: OrderStatus | string;
  payment: PaymentInfo;
}

export interface ReorderResult {
  cart: Cart;
  skipped: Array<{ name: string; reason: string; message: string }>;
}

export interface OrderListParams {
  page?: number;
  /** One status, or several (sent as repeated `status=` params). */
  status?: string | readonly string[];
}

export const ordersApi = {
  list: (params: OrderListParams = {}) =>
    api.get<Paginated<OrderSummary>>('orders/', {
      query: { page: params.page ?? 1, status: params.status, page_size: 10 },
    }),
  detail: (number: string) => api.get<Order>(`orders/${encodeURIComponent(number)}/`),
  cancel: (number: string, reason = '') =>
    api.post<Order>(`orders/${encodeURIComponent(number)}/cancel/`, { reason }),
  reorder: (number: string) =>
    api.post<ReorderResult>(`orders/${encodeURIComponent(number)}/reorder/`),
  /** Start (or restart) payment for an unpaid order; returns the new provider action. */
  pay: (number: string, paymentMethod?: string) =>
    api.post<PaymentInfo>(
      `orders/${encodeURIComponent(number)}/pay/`,
      paymentMethod ? { payment_method: paymentMethod } : {},
    ),
  /** Ask the backend to verify with the provider (never trust a browser redirect). */
  syncPayment: (number: string) =>
    api.post<PaymentSync>(`orders/${encodeURIComponent(number)}/payment/sync/`),
};

export const useOrders = (params: OrderListParams = {}) =>
  useQuery({
    queryKey: qk.orders.list(params),
    queryFn: () => ordersApi.list(params),
    placeholderData: keepPreviousData,
  });

/**
 * One order. With `poll`, it refreshes while the order is still moving: visibility-aware (no polling in a
 * background tab), with a growing delay while nothing changes, and it stops once the order is terminal.
 */
export function useOrder(number: string | undefined, { poll = false }: { poll?: boolean } = {}) {
  const backoff = useRef(createBackoff({ base: orderPolling.baseMs, max: orderPolling.maxMs }));
  return useQuery({
    queryKey: qk.orders.detail(number ?? ''),
    queryFn: async () => {
      const order = await ordersApi.detail(number as string);
      backoff.current.observe(`${order.status}|${order.payment_status}|${order.history.length}`);
      return order;
    },
    enabled: Boolean(number),
    refetchInterval: (query) =>
      poll && !isTerminalOrder(query.state.data?.status) ? backoff.current.interval() : false,
    refetchIntervalInBackground: false,
  });
}

function useOrderMutationBase() {
  const qc = useQueryClient();
  const refresh = async (number?: string) => {
    if (number) await qc.invalidateQueries({ queryKey: qk.orders.detail(number) });
    await qc.invalidateQueries({ queryKey: [...qk.orders.all, 'list'] });
  };
  return { qc, refresh };
}

export function useCancelOrder() {
  const { qc, refresh } = useOrderMutationBase();
  return useMutation({
    mutationFn: ({ number, reason }: { number: string; reason?: string }) =>
      ordersApi.cancel(number, reason),
    onSuccess: async (order, { number }) => {
      qc.setQueryData(qk.orders.detail(number), order);
      await refresh();
    },
  });
}

export function useReorder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (number: string) => ordersApi.reorder(number),
    onSuccess: (result) => {
      qc.setQueryData(qk.cart, result.cart);
      void qc.invalidateQueries({ queryKey: qk.cart });
    },
  });
}

export function usePayOrder() {
  const { refresh } = useOrderMutationBase();
  return useMutation({
    mutationFn: ({ number, method }: { number: string; method?: string }) =>
      ordersApi.pay(number, method),
    onSuccess: (_info, { number }) => refresh(number),
  });
}
