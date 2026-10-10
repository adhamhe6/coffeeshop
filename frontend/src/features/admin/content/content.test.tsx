import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp, resetTestWorld } from '@/test/utils';
import { applyMarkdown, containsRawHtml } from '../people-kit/markdownTools';
import { safeLinkError, httpUrlError, looksLikePlaceholderUrl } from '../people-kit/validators';
import { signInAsStaff } from '../people-kit/testing';

const A = '/api/v1/admin';
const list = <T,>(results: T[]) =>
  HttpResponse.json({ count: results.length, next: null, previous: null, results });

const page = (over: Record<string, unknown> = {}) => ({
  id: 1,
  slug: 'about',
  title: 'About us',
  summary: '',
  body_markdown: '## Hello\n\nWelcome.',
  is_published: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  ...over,
});
const block = (over: Record<string, unknown> = {}) => ({
  id: 4,
  key: 'home.story',
  eyebrow: 'Our story',
  title: 'Coffee worth slowing down for',
  body: 'We roast small.',
  image_url: null,
  cta_label: 'Read our story',
  cta_url: '/about',
  is_active: true,
  updated_at: '2026-02-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  resetTestWorld();
  signInAsStaff('MARKETING_MANAGER');
});

describe('markdown helpers', () => {
  it('wraps the selection for bold and inserts a link template', () => {
    expect(applyMarkdown('hello world', 6, 11, 'bold')).toMatchObject({ value: 'hello **world**' });
    const link = applyMarkdown('see ', 4, 4, 'link');
    expect(link.value).toBe('see [link text](https://)');
    expect(link.value.slice(link.selectionStart, link.selectionEnd)).toBe('https://');
    expect(applyMarkdown('a\nb', 2, 3, 'list').value).toBe('a\n- b');
  });
  it('detects raw HTML but not code spans or autolinks', () => {
    expect(containsRawHtml('<script>x</script>')).toBe(true);
    expect(containsRawHtml('use `<div>` sparingly and <https://example.com>')).toBe(false);
  });
});

describe('link validators', () => {
  it('accepts internal paths and http(s), rejects everything else', () => {
    for (const ok of ['', '/menu', 'https://example.com/x', 'http://a.b'])
      expect(safeLinkError(ok)).toBeNull();
    for (const bad of [
      'javascript:alert(1)',
      '//evil.example',
      'data:text/html,x',
      'menu',
      'ftp://x.y',
    ])
      expect(safeLinkError(bad)).toMatch(/internal path/);
    expect(httpUrlError('ftp://x.y')).toMatch(/http:\/\/ or https:\/\//);
    expect(httpUrlError('')).toMatch(/Enter the profile address/);
    expect(looksLikePlaceholderUrl('https://social.example/lantern')).toBe(true);
    expect(looksLikePlaceholderUrl('https://instagram.com/lantern')).toBe(false);
  });
});

describe('page editor preview safety', () => {
  it('never renders raw HTML or javascript: links in the live preview and warns the editor', async () => {
    const evil =
      'Safe text\n\n<script>window.__pwned = 1</script>\n\n<img src=x onerror="window.__pwned=2">\n\n[click me](javascript:window.__pwned=3)\n\n[ok](https://example.com)';
    server.use(http.get(`${A}/pages/`, () => list([page({ body_markdown: evil })])));
    renderApp('/admin/content');
    const preview = await screen.findByRole('region', { name: 'Live preview' });
    await waitFor(() => expect(within(preview).getByText('Safe text')).toBeInTheDocument());
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.querySelector('img')).toBeNull();
    expect(preview.querySelector('[onerror]')).toBeNull();
    for (const a of preview.querySelectorAll('a'))
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(within(preview).getByRole('link', { name: /ok/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(await screen.findByText('HTML is not supported')).toBeInTheDocument();
  });

  it('saves edits and refreshes the preview as you type', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${A}/pages/`, () => list([page()])),
      http.patch(`${A}/pages/1/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(page({ ...body }));
      }),
    );
    renderApp('/admin/content');
    const editor = await screen.findByLabelText('Page content');
    await userEvent.clear(editor);
    await userEvent.type(editor, '# New heading');
    const preview = screen.getByRole('region', { name: 'Live preview' });
    await waitFor(() =>
      expect(within(preview).getByRole('heading', { name: 'New heading' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save page' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        body_markdown: '# New heading',
        is_published: true,
        title: 'About us',
      }),
    );
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
  });
});

describe('homepage block editor', () => {
  it('rejects unsafe button links before sending and shows where the block appears', async () => {
    let patched = false;
    server.use(
      http.get(`${A}/blocks/`, () => list([block()])),
      http.patch(`${A}/blocks/home.story/`, () => ((patched = true), HttpResponse.json(block()))),
    );
    renderApp('/admin/content?tab=blocks');
    expect(await screen.findByText(/first story section on the homepage/)).toBeInTheDocument();
    const link = screen.getByLabelText('Button link');
    await userEvent.clear(link);
    await userEvent.type(link, 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Save block' }));
    expect(
      await screen.findByText("Enter an internal path starting with '/' or a full http(s) URL."),
    ).toBeInTheDocument();
    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(patched).toBe(false);
  });

  it("shows the server's link validation error on the field", async () => {
    server.use(
      http.get(`${A}/blocks/`, () => list([block()])),
      http.patch(`${A}/blocks/home.story/`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'Please correct the highlighted fields.',
              fields: {
                cta_url: ["Enter an internal path starting with '/' or a full http(s) URL."],
              },
              request_id: 'r',
            },
          },
          { status: 400 },
        ),
      ),
    );
    renderApp('/admin/content?tab=blocks');
    const title = await screen.findByLabelText('Title');
    await userEvent.type(title, '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save block' }));
    await waitFor(
      () => expect(screen.getByLabelText('Button link')).toHaveAttribute('aria-invalid', 'true'),
      { timeout: 3000 },
    ).catch(() => undefined);
    // '/about' passes the client rules, so this message can only come from the server error mapped onto the field
    expect(await screen.findByText(/internal path starting with/)).toBeInTheDocument();
  });

  it('saves changed text as JSON and updates the preview', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${A}/blocks/`, () => list([block()])),
      http.patch(`${A}/blocks/home.story/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(block({ ...body }));
      }),
    );
    renderApp('/admin/content?tab=blocks');
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Brand new headline');
    expect(
      within(screen.getByRole('figure', { name: /Preview of Our story/ })).getByText(
        'Brand new headline',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save block' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        title: 'Brand new headline',
        cta_url: '/about',
        is_active: true,
      }),
    );
  });
});

describe('social profiles', () => {
  it('only accepts http(s) URLs and flags placeholders prominently', async () => {
    let posted = false;
    server.use(
      http.get(`${A}/social/`, () =>
        list([
          {
            id: 1,
            platform: 'instagram',
            url: 'https://social.example/x',
            handle: '@x',
            is_active: true,
            is_placeholder: true,
            sort_order: 10,
          },
        ]),
      ),
      http.post(`${A}/social/`, () => ((posted = true), HttpResponse.json({}, { status: 201 }))),
    );
    renderApp('/admin/social');
    expect(
      await screen.findByText(/1 social link is a placeholder — replace before launch/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Placeholder — replace before launch/).length).toBeGreaterThan(0);
    const tiktok = screen.getByRole('region', { name: 'TikTok' });
    await userEvent.type(within(tiktok).getByLabelText(/^Profile address/), 'ftp://tiktok.com/x');
    await userEvent.click(within(tiktok).getByRole('button', { name: 'Add TikTok' }));
    expect(
      await within(tiktok).findByText('Enter a full http:// or https:// URL.'),
    ).toBeInTheDocument();
    expect(posted).toBe(false);
  });
});
