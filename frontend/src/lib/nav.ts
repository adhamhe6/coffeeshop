/** Only same-origin absolute paths are acceptable redirect targets (blocks `//evil.com`, `https://…`, `javascript:`). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** Route prefixes that require a signed-in customer (staff areas are guarded separately). */
const PROTECTED_PREFIXES = ['/account', '/orders', '/admin'];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function loginUrl(next?: string): string {
  return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

export const isExternalUrl = (href: string) => /^https?:\/\//i.test(href);

/** Accept internal paths and http(s) URLs from the CMS; anything else (javascript:, data:) is rejected. */
export function isSafeLink(href: string | undefined | null): href is string {
  if (!href) return false;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  return isExternalUrl(href);
}
