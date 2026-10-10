import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/server';
import { api, buildUrl, newIdempotencyKey, onUnauthorized, readCookie } from './client';
import { ApiError } from './errors';
import { resetTestWorld } from '@/test/utils';

beforeEach(() => resetTestWorld());

describe('buildUrl', () => {
  it('joins base + path and serialises query params, skipping empty values', () => {
    expect(
      buildUrl('/products/', {
        q: 'flat white',
        page: 2,
        featured: true,
        empty: '',
        none: undefined,
        tag: ['a', 'b'],
      }),
    ).toBe('/api/v1/products/?q=flat+white&page=2&featured=true&tag=a&tag=b');
  });
});

describe('CSRF', () => {
  it('fetches auth/csrf/ once, then sends X-CSRFToken from the cookie on unsafe methods', async () => {
    const csrfCalls = vi.fn();
    const seen: Array<string | null> = [];
    server.use(
      http.get('/api/v1/auth/csrf/', () => {
        csrfCalls();
        document.cookie = 'lantern_csrftoken=tok123; path=/';
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('/api/v1/thing/', ({ request }) => {
        seen.push(request.headers.get('X-CSRFToken'));
        return HttpResponse.json({ ok: true });
      }),
    );
    await api.post('thing/', { a: 1 });
    await api.post('thing/', { a: 2 });
    expect(csrfCalls).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['tok123', 'tok123']);
    expect(readCookie('lantern_csrftoken')).toBe('tok123');
  });

  it('does not call the csrf endpoint or send the header for GET requests', async () => {
    const csrfCalls = vi.fn();
    let header: string | null = 'unset';
    server.use(
      http.get('/api/v1/auth/csrf/', () => {
        csrfCalls();
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('/api/v1/thing/', ({ request }) => {
        header = request.headers.get('X-CSRFToken');
        return HttpResponse.json({});
      }),
    );
    await api.get('thing/');
    expect(csrfCalls).not.toHaveBeenCalled();
    expect(header).toBeNull();
  });

  it('refreshes the token and retries once when the server reports a CSRF failure', async () => {
    document.cookie = 'lantern_csrftoken=stale; path=/';
    let attempts = 0;
    server.use(
      http.get('/api/v1/auth/csrf/', () => {
        document.cookie = 'lantern_csrftoken=fresh; path=/';
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('/api/v1/thing/', ({ request }) => {
        attempts++;
        if (request.headers.get('X-CSRFToken') !== 'fresh')
          return HttpResponse.json(
            { error: { code: 'permission_denied', message: 'CSRF Failed: token incorrect.' } },
            { status: 403 },
          );
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(api.post('thing/', {})).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });
});

describe('error envelope', () => {
  it('parses code, message, field errors and request id into ApiError', async () => {
    server.use(
      http.post('/api/v1/thing/', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'Please correct the highlighted fields.',
              fields: { email: ['Enter a valid email.'], address: { city: ['Required.'] } },
              request_id: 'abc-123',
              items: [1, 2],
            },
          },
          { status: 400 },
        ),
      ),
    );
    document.cookie = 'lantern_csrftoken=t; path=/';
    const err = await api.post('thing/', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(400);
    expect(e.code).toBe('validation_error');
    expect(e.message).toBe('Please correct the highlighted fields.');
    expect(e.fields).toEqual({ email: ['Enter a valid email.'], address: ['Required.'] });
    expect(e.requestId).toBe('abc-123');
    expect(e.extra).toEqual({ items: [1, 2] });
  });

  it('falls back gracefully for non-envelope error bodies (proxy HTML, 502)', async () => {
    server.use(
      http.get(
        '/api/v1/thing/',
        () => new HttpResponse('<html>Bad gateway</html>', { status: 502 }),
      ),
    );
    const e = (await api.get('thing/').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(502);
    expect(e.code).toBe('http_error');
    expect(e.message).toMatch(/server had a problem/i);
  });

  it('maps network failures to status 0', async () => {
    server.use(http.get('/api/v1/thing/', () => HttpResponse.error()));
    const e = (await api.get('thing/').catch((x: unknown) => x)) as ApiError;
    expect(e.isNetwork).toBe(true);
  });

  it('returns undefined for 204 responses', async () => {
    server.use(http.get('/api/v1/thing/', () => new HttpResponse(null, { status: 204 })));
    await expect(api.get('thing/')).resolves.toBeUndefined();
  });
});

describe('401 handling', () => {
  it('publishes the unauthorized event for a 401', async () => {
    server.use(
      http.get('/api/v1/thing/', () =>
        HttpResponse.json(
          { error: { code: 'not_authenticated', message: 'Sign in.' } },
          { status: 401 },
        ),
      ),
    );
    const handler = vi.fn();
    const off = onUnauthorized(handler);
    await expect(api.get('thing/')).rejects.toBeInstanceOf(ApiError);
    off();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ status: 401, code: 'not_authenticated' });
  });

  it('stays silent when the call opts out (login form, auth/me)', async () => {
    server.use(
      http.get('/api/v1/thing/', () =>
        HttpResponse.json({ error: { code: 'not_authenticated', message: 'x' } }, { status: 401 }),
      ),
    );
    const handler = vi.fn();
    const off = onUnauthorized(handler);
    await api.get('thing/', { skipUnauthorizedEvent: true }).catch(() => undefined);
    off();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Idempotency-Key', () => {
  it('generates RFC 4122 v4 UUIDs and sends the header when provided', async () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    let received: string | null = null;
    document.cookie = 'lantern_csrftoken=t; path=/';
    server.use(
      http.post('/api/v1/checkout/', ({ request }) => {
        received = request.headers.get('Idempotency-Key');
        return HttpResponse.json({});
      }),
    );
    await api.post('checkout/', {}, { idempotencyKey: key });
    expect(received).toBe(key);
  });
});
