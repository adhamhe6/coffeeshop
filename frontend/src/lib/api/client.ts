import { ApiError, normaliseFields, type ErrorEnvelope } from './errors';

/**
 * Fetch wrapper for the Lantern API.
 *
 *  - same-origin session cookies (`credentials: 'include'`), JSON in/out
 *  - CSRF: the token cookie `lantern_csrftoken` is primed once via `GET auth/csrf/` and echoed in `X-CSRFToken`
 *    on unsafe methods (one automatic retry if the server says the token is stale)
 *  - errors are parsed from the `{error:{code,message,fields,request_id}}` envelope into `ApiError`
 *  - 401 responses publish an "unauthorized" event (see `onUnauthorized`) unless the call opts out
 */

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
export const CSRF_COOKIE = 'lantern_csrftoken';
export const CSRF_HEADER = 'X-CSRFToken';

type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  query?: QueryParams;
  /** Plain objects are JSON-encoded; FormData is sent as multipart. */
  body?: unknown;
  /** Sent as `Idempotency-Key` (required by `checkout/`). Use `newIdempotencyKey()`. */
  idempotencyKey?: string;
  /** Do not publish the global unauthorized event for a 401 (login form, `auth/me/`). */
  skipUnauthorizedEvent?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── Unauthorized event bus ───────────────────────────────────────────────
type UnauthorizedHandler = (error: ApiError) => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();
export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

// ── CSRF ─────────────────────────────────────────────────────────────────
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

let csrfPromise: Promise<string | null> | null = null;

/** Resolves with the CSRF token, calling `auth/csrf/` at most once while the cookie is missing. */
export function ensureCsrfToken(force = false): Promise<string | null> {
  if (!force) {
    const existing = readCookie(CSRF_COOKIE);
    if (existing) return Promise.resolve(existing);
    if (csrfPromise) return csrfPromise;
  }
  csrfPromise = fetch(buildUrl('auth/csrf/'), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (res) => {
      const token = readCookie(CSRF_COOKIE);
      if (token) return token;
      // Some deployments also return the token in the body.
      try {
        const data = (await res.json()) as { csrfToken?: string; csrf_token?: string };
        return data.csrfToken ?? data.csrf_token ?? null;
      } catch {
        return null;
      }
    })
    .catch(() => null)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

export function resetCsrfForTests() {
  csrfPromise = null;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback for very old browsers / insecure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── URL + parsing ────────────────────────────────────────────────────────
export function buildUrl(path: string, query?: QueryParams): string {
  const clean = path.replace(/^\/+/, '');
  const url = `${API_BASE.replace(/\/+$/, '')}/${clean}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseError(res: Response): Promise<ApiError> {
  let envelope: Partial<ErrorEnvelope> | undefined;
  let text = '';
  try {
    text = await res.text();
    envelope = text ? (JSON.parse(text) as Partial<ErrorEnvelope>) : undefined;
  } catch {
    envelope = undefined;
  }
  const err = envelope?.error;
  if (err && typeof err === 'object') {
    const { code, message, fields, request_id, ...extra } = err;
    return new ApiError({
      status: res.status,
      code: code || 'error',
      message: message || res.statusText || 'Request failed',
      fields: normaliseFields(fields),
      requestId: request_id,
      extra,
    });
  }
  // Non-envelope bodies (proxy errors, HTML, DRF `{detail}` from unexpected places).
  const detail = (envelope as { detail?: unknown } | undefined)?.detail;
  const fallback =
    res.status >= 500
      ? 'The server had a problem. Please try again.'
      : res.status === 404
        ? 'We could not find that.'
        : 'The request could not be completed.';
  return new ApiError({
    status: res.status,
    code: 'http_error',
    message: typeof detail === 'string' ? detail : fallback,
    requestId: res.headers.get('X-Request-ID') ?? undefined,
  });
}

async function send(
  method: string,
  path: string,
  opts: RequestOptions,
  retried = false,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (UNSAFE.has(method)) {
    const token = await ensureCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      credentials: 'include',
      headers,
      body,
      signal: opts.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  // A stale CSRF token (e.g. after login rotated it) is recoverable exactly once.
  if (res.status === 403 && UNSAFE.has(method) && !retried) {
    const probe = await res
      .clone()
      .text()
      .catch(() => '');
    if (/csrf/i.test(probe)) {
      await ensureCsrfToken(true);
      return send(method, path, opts, true);
    }
  }
  return res;
}

export async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const res = await send(method.toUpperCase(), path, opts);
  if (!res.ok) {
    const error = await parseError(res);
    if (error.status === 401 && !opts.skipUnauthorizedEvent) {
      unauthorizedHandlers.forEach((h) => h(error));
    }
    throw error;
  }
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Download-style endpoints (CSV export): returns the Blob and suggested filename. */
export async function requestBlob(
  path: string,
  opts: RequestOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await send('GET', path, { ...opts, headers: { Accept: '*/*', ...opts.headers } });
  if (!res.ok) throw await parseError(res);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? null };
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', path, { ...opts, body }),
  delete: <T = void>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
