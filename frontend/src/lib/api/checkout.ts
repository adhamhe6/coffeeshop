import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import { unwrapList } from './util';
import type { Cart, CartIssue, CartItem } from './types';
import type { Order, OrderType, PaymentInfo } from './orders';

// ── Preview (the server's pricing breakdown; the UI never computes money) ──
export interface PreviewLine extends CartItem {
  discount: string;
}

export interface PreviewCoupon {
  code: string;
  name: string;
  discount_type: 'PERCENT' | 'FIXED';
  discount: string;
  is_automatic: boolean;
}

export interface CartPreview {
  order_type: OrderType;
  branch_id: number | null;
  currency: string;
  items: PreviewLine[];
  item_count: number;
  subtotal: string;
  discount_total: string;
  delivery_fee: string;
  tax_total: string;
  tax_rate: string;
  tax_label: string;
  prices_include_tax: boolean;
  total: string;
  coupon: PreviewCoupon | null;
  coupon_error: { code: string; message: string } | null;
  delivery: {
    fee: string;
    min_order_total: string;
    eta_minutes: number;
    zone: string | null;
  } | null;
  requested_for: string | null;
  estimated_ready_at: string | null;
  issues: CartIssue[];
  checkout_blockers: CartIssue[];
  can_checkout: boolean;
}

export interface PreviewRequest {
  order_type: OrderType;
  branch_id?: number | null;
  address_id?: number | null;
  coupon_code?: string;
  requested_for?: string | null;
}

export interface CouponValidation {
  valid: boolean;
  code: string;
  name: string;
  discount_type: 'PERCENT' | 'FIXED';
  value: string;
  discount: string;
  subtotal: string;
  min_order_total: string;
  max_discount: string | null;
}

export interface PaymentMethod {
  key: string;
  label: string;
  description?: string;
  is_sandbox: boolean;
  offline: boolean;
}

export interface DeliveryZone {
  id: number;
  slug: string;
  name: string;
  branch_slugs: string[];
}

export interface Slot {
  starts_at: string;
  label: string;
}

export interface SlotsResponse {
  date: string;
  timezone: string;
  asap_available: boolean;
  asap_eta: string | null;
  unavailable_code: string | null;
  unavailable_message: string | null;
  slots: Slot[];
}

export interface CheckoutPayload {
  branch_id: number;
  order_type: OrderType;
  address_id?: number | null;
  requested_for?: string | null;
  coupon_code?: string;
  payment_method: string;
  customer_notes?: string;
  accept_terms: boolean;
  expected_total?: string | null;
  phone?: string;
}

export interface CheckoutResult {
  order: Order;
  payment: PaymentInfo;
}

export interface DemoPayment {
  reference: string;
  order_number: string;
  total: string;
  currency: string;
  items: Array<{ name: string; quantity: number; line_total: string }>;
  status: string;
  order_status: string;
  can_complete: boolean;
  sandbox: boolean;
  notice: string;
}

export type DemoOutcome = 'success' | 'decline' | 'cancel';

export interface DemoCompletion {
  outcome: string;
  payment_status: string;
  order_number: string;
  order_status: string;
  order_payment_status: string;
  can_retry: boolean;
  sandbox: boolean;
  event_outcome: string;
}

export const checkoutApi = {
  preview: (body: PreviewRequest, signal?: AbortSignal) =>
    api.post<CartPreview>('cart/preview/', body, { signal }),
  validateCoupon: (code: string, orderType: OrderType, branchId?: number | null) =>
    api.post<CouponValidation>('coupons/validate/', {
      code,
      order_type: orderType,
      branch_id: branchId ?? null,
    }),
  acknowledgePrices: () => api.post<Cart>('cart/acknowledge-prices/'),
  updateNote: (id: number, note: string) => api.patch<Cart>(`cart/items/${id}/`, { note }),
  methods: async () => unwrapList(await api.get<PaymentMethod[]>('payments/methods/')),
  zones: async () => unwrapList(await api.get<DeliveryZone[]>('delivery-zones/')),
  slots: (branch: string, type: OrderType, date?: string) =>
    api.get<SlotsResponse>(`branches/${encodeURIComponent(branch)}/slots/`, {
      query: { type, date },
    }),
  /** `Idempotency-Key` is mandatory; the same key must be reused for retries of the same attempt. */
  place: (payload: CheckoutPayload, idempotencyKey: string) =>
    api.post<CheckoutResult>('checkout/', payload, { idempotencyKey }),
  demoPayment: (reference: string) =>
    api.get<DemoPayment>(`payments/demo/${encodeURIComponent(reference)}/`),
  completeDemoPayment: (reference: string, outcome: DemoOutcome) =>
    api.post<DemoCompletion>(`payments/demo/${encodeURIComponent(reference)}/complete/`, {
      outcome,
    }),
};

/** Server breakdown for the current cart + choices. Lives under the cart key so cart edits refresh it. */
export function usePreview(request: PreviewRequest | null, enabled = true) {
  return useQuery({
    queryKey: [...qk.cart, 'preview', request] as const,
    queryFn: ({ signal }) => checkoutApi.preview(request as PreviewRequest, signal),
    enabled: enabled && request !== null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
}

export const usePaymentMethods = () =>
  useQuery({
    queryKey: qk.checkout.methods,
    queryFn: checkoutApi.methods,
    staleTime: 5 * 60_000,
  });

export const useDeliveryZones = () =>
  useQuery({ queryKey: qk.checkout.zones, queryFn: checkoutApi.zones, staleTime: 5 * 60_000 });

export function useSlots(branch: string | undefined, type: OrderType, date?: string) {
  return useQuery({
    queryKey: qk.checkout.slots(branch ?? '', type, date ?? ''),
    queryFn: () => checkoutApi.slots(branch as string, type, date),
    enabled: Boolean(branch),
    staleTime: 60_000,
  });
}

export function useAcknowledgePrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: checkoutApi.acknowledgePrices,
    onSuccess: (cart) => {
      qc.setQueryData(qk.cart, cart);
      void qc.invalidateQueries({ queryKey: qk.cart });
    },
  });
}

export function useUpdateCartNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => checkoutApi.updateNote(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.cart }),
  });
}

export const useDemoPayment = (reference: string | undefined) =>
  useQuery({
    queryKey: qk.checkout.demoPayment(reference ?? ''),
    queryFn: () => checkoutApi.demoPayment(reference as string),
    enabled: Boolean(reference),
    retry: false,
  });

export function useCompleteDemoPayment(reference: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (outcome: DemoOutcome) => checkoutApi.completeDemoPayment(reference, outcome),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.checkout.demoPayment(reference) });
      void qc.invalidateQueries({ queryKey: qk.orders.all });
    },
  });
}
