import { newIdempotencyKey } from '@/lib/api/client';
import type { CheckoutPayload } from '@/lib/api/checkout';

/**
 * One Idempotency-Key per checkout attempt, kept in sessionStorage so that a retry after a dropped connection
 * (outcome unknown) re-sends the SAME key and the server replays the order instead of creating a second one.
 *
 * The key is tied to a fingerprint of what is being ordered. If the customer changes the order (branch, address,
 * time, coupon, payment method, notes) it is a different attempt and gets a fresh key. `expected_total` is
 * deliberately not part of the fingerprint: accepting a new price must not discard a key whose outcome is unknown.
 */
const STORAGE_KEY = 'lantern.checkout.attempt';

interface Stored {
  key: string;
  fingerprint: string;
}

export function fingerprintOf(payload: CheckoutPayload): string {
  const { expected_total: _ignored, ...rest } = payload;
  void _ignored;
  return JSON.stringify(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
}

function read(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return typeof parsed.key === 'string' && typeof parsed.fingerprint === 'string'
      ? { key: parsed.key, fingerprint: parsed.fingerprint }
      : null;
  } catch {
    return null;
  }
}

let memory: Stored | null = null;

export function attemptKeyFor(payload: CheckoutPayload): string {
  const fingerprint = fingerprintOf(payload);
  const existing = read() ?? memory;
  if (existing && existing.fingerprint === fingerprint) return existing.key;
  const next = { key: newIdempotencyKey(), fingerprint };
  memory = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // sessionStorage unavailable: the in-memory copy still protects retries within this page view.
  }
  return next.key;
}

/** Call after the order was created (or the attempt is abandoned) so the next order starts fresh. */
export function clearAttemptKey(): void {
  memory = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
