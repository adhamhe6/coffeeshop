/**
 * Backoff for polling server state: every response that looks the same as the last one lengthens the wait
 * (base → base × factor → … → max); a response that changed resets it. Pure, so it is easy to test.
 */
export interface Backoff {
  /** Feed the latest response signature; returns nothing, updates the internal streak. */
  observe: (signature: string) => void;
  /** Milliseconds to wait before the next poll. */
  interval: () => number;
  reset: () => void;
}

export function createBackoff({
  base = 8_000,
  max = 60_000,
  factor = 1.6,
}: { base?: number; max?: number; factor?: number } = {}): Backoff {
  let last: string | null = null;
  let streak = 0;
  return {
    observe(signature) {
      if (signature === last) streak += 1;
      else streak = 0;
      last = signature;
    },
    interval: () => Math.min(max, Math.round(base * factor ** streak)),
    reset() {
      last = null;
      streak = 0;
    },
  };
}
