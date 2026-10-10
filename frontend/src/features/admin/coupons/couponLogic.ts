import type { AdminCoupon, AppliesTo, CouponPayload, DiscountType } from '@/lib/api/peopleTypes';
import { isoToZonedInput, zonedInputToIso } from '../people-kit/datetime';

export type CouponStatusKey = 'active' | 'scheduled' | 'expired' | 'exhausted' | 'inactive';

export const COUPON_STATUS_LABEL: Record<CouponStatusKey, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
  exhausted: 'Exhausted',
  inactive: 'Inactive',
};

type StatusInput = Pick<
  AdminCoupon,
  'is_active' | 'starts_at' | 'ends_at' | 'usage_limit' | 'times_redeemed'
>;

/** Mirrors what the storefront does with a coupon (checked server-side again at checkout). */
export function couponStatus(c: StatusInput, now = Date.now()): CouponStatusKey {
  if (!c.is_active) return 'inactive';
  if (c.usage_limit !== null && c.usage_limit !== undefined && c.times_redeemed >= c.usage_limit)
    return 'exhausted';
  if (c.ends_at && Date.parse(c.ends_at) <= now) return 'expired';
  if (c.starts_at && Date.parse(c.starts_at) > now) return 'scheduled';
  return 'active';
}

// ── form model ──────────────────────────────────────────────────────────
export interface CouponFormValues {
  code: string;
  name: string;
  description: string;
  discount_type: DiscountType;
  value: string;
  max_discount: string;
  min_order_total: string;
  applies_to: AppliesTo;
  category_ids: number[];
  product_ids: number[];
  first_order_only: boolean;
  is_automatic: boolean;
  /** `datetime-local` strings in the STORE timezone. */
  starts_at: string;
  ends_at: string;
  usage_limit: string;
  per_customer_limit: string;
  is_active: boolean;
}

export const BLANK_COUPON: CouponFormValues = {
  code: '',
  name: '',
  description: '',
  discount_type: 'PERCENT',
  value: '',
  max_discount: '',
  min_order_total: '',
  applies_to: 'ALL',
  category_ids: [],
  product_ids: [],
  first_order_only: false,
  is_automatic: false,
  starts_at: '',
  ends_at: '',
  usage_limit: '',
  per_customer_limit: '',
  is_active: true,
};

const plain = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
};

export function couponToForm(
  c: AdminCoupon,
  timeZone: string,
  opts: { clone?: boolean } = {},
): CouponFormValues {
  return {
    code: opts.clone ? '' : (c.code ?? ''),
    name: opts.clone ? `${c.name} (copy)` : c.name,
    description: c.description ?? '',
    discount_type: c.discount_type,
    value: plain(c.value),
    max_discount: plain(c.max_discount),
    min_order_total: Number(c.min_order_total) > 0 ? plain(c.min_order_total) : '',
    applies_to: c.applies_to ?? 'ALL',
    category_ids: c.category_ids ?? [],
    product_ids: c.product_ids ?? [],
    first_order_only: c.first_order_only ?? false,
    is_automatic: c.is_automatic ?? false,
    starts_at: isoToZonedInput(c.starts_at, timeZone),
    ends_at: isoToZonedInput(c.ends_at, timeZone),
    usage_limit: c.usage_limit === null || c.usage_limit === undefined ? '' : String(c.usage_limit),
    per_customer_limit:
      c.per_customer_limit === null || c.per_customer_limit === undefined
        ? ''
        : String(c.per_customer_limit),
    is_active: opts.clone ? true : (c.is_active ?? true),
  };
}

/** Decimal STRING for the API (rounded to cents; the server remains the authority). */
const decimal = (v: string) => Number(v).toFixed(2);
const intOrNull = (v: string) => (v.trim() === '' ? null : Number.parseInt(v, 10));

export function formToPayload(v: CouponFormValues, timeZone: string): CouponPayload {
  const percent = v.discount_type === 'PERCENT';
  return {
    code: v.is_automatic && !v.code.trim() ? '' : v.code.trim().toUpperCase(),
    name: v.name.trim(),
    description: v.description.trim(),
    discount_type: v.discount_type,
    value: decimal(v.value),
    max_discount: percent && v.max_discount.trim() !== '' ? decimal(v.max_discount) : null,
    min_order_total: v.min_order_total.trim() === '' ? '0.00' : decimal(v.min_order_total),
    applies_to: v.applies_to,
    category_ids: v.applies_to === 'CATEGORIES' ? v.category_ids : [],
    product_ids: v.applies_to === 'PRODUCTS' ? v.product_ids : [],
    first_order_only: v.first_order_only,
    is_automatic: v.is_automatic,
    starts_at: zonedInputToIso(v.starts_at, timeZone),
    ends_at: zonedInputToIso(v.ends_at, timeZone),
    usage_limit: intOrNull(v.usage_limit),
    per_customer_limit: intOrNull(v.per_customer_limit),
    is_active: v.is_active,
  };
}

// ── plain-language summary ──────────────────────────────────────────────
export interface SummaryContext {
  /** Money formatter (store currency). */
  money: (value: string | number) => string;
  timeZone: string;
  categoryNames: string[];
  productNames: string[];
  now?: Date;
}

function shortDate(iso: string, tz: string, now: Date): string {
  const d = new Date(iso);
  const sameYear =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(d) ===
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(now);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * "15% off Seasonal drinks, max $6, orders of $10 or more, first order only, until Nov 30." Built from the form
 * values only; it never computes a price (the server decides discounts at checkout).
 */
export function describeCoupon(v: CouponFormValues, ctx: SummaryContext): string {
  const now = ctx.now ?? new Date();
  const amount = Number(v.value);
  if (!v.value.trim() || !Number.isFinite(amount) || amount <= 0) {
    return 'Fill in the discount to see a plain-language summary.';
  }
  const head =
    v.discount_type === 'PERCENT' ? `${plain(v.value)}% off` : `${ctx.money(amount)} off`;
  let scope = 'the whole order';
  if (v.applies_to === 'CATEGORIES') {
    scope = ctx.categoryNames.length ? list(ctx.categoryNames) : 'selected categories';
  } else if (v.applies_to === 'PRODUCTS') {
    scope = ctx.productNames.length ? list(ctx.productNames) : 'selected products';
  }
  const parts: string[] = [`${head} ${scope}`];
  if (v.discount_type === 'PERCENT' && Number(v.max_discount) > 0)
    parts.push(`max ${ctx.money(Number(v.max_discount))}`);
  if (Number(v.min_order_total) > 0)
    parts.push(`orders of ${ctx.money(Number(v.min_order_total))} or more`);
  if (v.first_order_only) parts.push("customer's first order only");
  const perCustomer = Number.parseInt(v.per_customer_limit, 10);
  if (perCustomer > 0) parts.push(`${perCustomer} use${perCustomer === 1 ? '' : 's'} per customer`);
  const total = Number.parseInt(v.usage_limit, 10);
  if (total > 0) parts.push(`first ${total} redemptions only`);

  const startIso = zonedInputToIso(v.starts_at, ctx.timeZone);
  const endIso = zonedInputToIso(v.ends_at, ctx.timeZone);
  if (startIso && endIso)
    parts.push(
      `${shortDate(startIso, ctx.timeZone, now)} to ${shortDate(endIso, ctx.timeZone, now)}`,
    );
  else if (endIso) parts.push(`until ${shortDate(endIso, ctx.timeZone, now)}`);
  else if (startIso) parts.push(`from ${shortDate(startIso, ctx.timeZone, now)}`);

  const how = v.is_automatic
    ? 'Applied automatically at checkout: '
    : v.code.trim()
      ? `Customers enter ${v.code.trim().toUpperCase()}: `
      : 'Customers enter the code: ';
  return `${how}${parts.join(', ')}.`;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Memorable-ish random code, e.g. `LANTERN-7KQ4M`. Uniqueness is enforced by the server. */
export function generateCouponCode(prefix = 'LANTERN'): string {
  const rand = new Uint32Array(5);
  crypto.getRandomValues(rand);
  const suffix = Array.from(rand, (n) => CODE_CHARS.charAt(n % CODE_CHARS.length)).join('');
  return `${prefix}-${suffix}`;
}
