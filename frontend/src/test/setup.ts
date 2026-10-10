import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '@/mocks/server';

// Pages are lazy chunks: the first dynamic import on a busy machine can exceed the 1 s default.
configure({ asyncUtilTimeout: 4000 });

// ── Browser APIs jsdom lacks (Radix, IntersectionObserver users, matchMedia) ──
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??=
  IntersectionObserverStub as unknown as typeof IntersectionObserver;

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.setPointerCapture ??= () => {};
window.scrollTo = (() => {}) as typeof window.scrollTo;

/**
 * matchMedia that understands `(min-width|max-width: Npx)` against `window.innerWidth` (jsdom default 1024),
 * so responsive components can be tested with `setViewport(390)`.
 */
function evaluate(query: string): boolean {
  if (/prefers-reduced-motion:\s*reduce/.test(query))
    return Boolean((window as unknown as { __reducedMotion?: boolean }).__reducedMotion);
  const min = /min-width:\s*([\d.]+)px/.exec(query);
  const max = /max-width:\s*([\d.]+)px/.exec(query);
  const w = window.innerWidth;
  return (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
}
const listeners = new Set<() => void>();
window.matchMedia = ((query: string) => ({
  get matches() {
    return evaluate(query);
  },
  media: query,
  onchange: null,
  addEventListener: (_: string, cb: () => void) => listeners.add(cb),
  removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  addListener: (cb: () => void) => listeners.add(cb),
  removeListener: (cb: () => void) => listeners.delete(cb),
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
  window.innerWidth = 1024;
  document.cookie = 'lantern_csrftoken=; Max-Age=0; path=/';
});
afterAll(() => server.close());
