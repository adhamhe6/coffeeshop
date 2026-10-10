/** Client-side mirrors of the server's link validators (the server stays the authority and has the last word). */

export const SAFE_LINK_MESSAGE = "Enter an internal path starting with '/' or a full http(s) URL.";
export const HTTP_URL_MESSAGE = 'Enter a full http:// or https:// URL.';

function hasHttpScheme(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.host);
  } catch {
    return false;
  }
}

/** Internal path (`/menu`) or http(s) URL; blank is allowed. Returns an error message or `null`. */
export function safeLinkError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')) return null;
  return hasHttpScheme(v) ? null : SAFE_LINK_MESSAGE;
}

/** http(s) URL only (social profiles). Blank is an error. */
export function httpUrlError(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter the profile address.';
  return hasHttpScheme(v) ? null : HTTP_URL_MESSAGE;
}

/** Reserved/example hosts are never real profiles. */
export function looksLikePlaceholderUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === 'example.com' ||
      host === 'example.org' ||
      host.endsWith('.example') ||
      host.endsWith('.example.com') ||
      host.endsWith('.example.org') ||
      host.includes('placeholder')
    );
  } catch {
    return false;
  }
}
