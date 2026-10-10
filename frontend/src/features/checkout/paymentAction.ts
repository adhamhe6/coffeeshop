import type { PaymentAction } from '@/lib/api/orders';

export type ResolvedAction =
  { kind: 'internal'; to: string } | { kind: 'external'; url: string } | { kind: 'none' };

/**
 * Decide how to follow the payment `action` returned by checkout / pay / sync:
 *  - same-origin URLs (the sandbox page, whatever host the backend was configured with) are router navigations,
 *  - other http(s) URLs (Stripe Checkout) are full-page redirects,
 *  - anything else (javascript:, data:, malformed) is ignored.
 */
export function resolvePaymentAction(
  action: PaymentAction | null | undefined,
  origin: string = window.location.origin,
): ResolvedAction {
  if (!action || action.type !== 'redirect' || !action.url) return { kind: 'none' };
  const raw = action.url.trim();
  if (raw.startsWith('/') && !raw.startsWith('//')) return { kind: 'internal', to: raw };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: 'none' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'none' };
  if (parsed.origin === origin) {
    return { kind: 'internal', to: `${parsed.pathname}${parsed.search}${parsed.hash}` };
  }
  return { kind: 'external', url: parsed.toString() };
}
