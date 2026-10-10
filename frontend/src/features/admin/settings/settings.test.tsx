import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp, resetTestWorld } from '@/test/utils';
import { signInAsStaff } from '../people-kit/testing';
import { diffSettings, settingsToValues, taxFieldsChanged } from './settingsLogic';

const A = '/api/v1/admin';
const settings = (over: Record<string, unknown> = {}) => ({
  brand_name: 'Lantern',
  tagline: 'Slow-roasted.',
  legal_name: '',
  currency: 'USD',
  support_email: 'hello@x.example',
  support_phone: '',
  business_address: '',
  logo_url: null,
  tax_rate: '8.00',
  tax_label: 'Sales tax (demo rate)',
  prices_include_tax: false,
  auto_confirm_paid_orders: false,
  enable_reviews: true,
  ordering_enabled: true,
  allowed_checkout_methods: ['stripe', 'demo', 'cash'],
  available_checkout_methods: ['demo', 'cash'],
  updated_at: '2026-02-01T00:00:00Z',
  ...over,
});

let current = settings();
let patches: Record<string, unknown>[] = [];

// Warm the lazily-loaded route chunk so the first test is not charged for compiling it.
beforeAll(async () => {
  await import('@/features/admin/settings/pages/SettingsPage');
}, 60_000);

beforeEach(() => {
  resetTestWorld();
  signInAsStaff('ADMIN');
  current = settings();
  patches = [];
  server.use(
    http.get(`${A}/settings/`, () => HttpResponse.json(current)),
    http.patch(`${A}/settings/`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      current = settings({ ...current, ...body });
      return HttpResponse.json(current);
    }),
    http.get('/api/v1/payments/methods/', () =>
      HttpResponse.json([
        {
          key: 'demo',
          label: 'Sandbox payment',
          description: 'No real money moves.',
          is_sandbox: true,
          offline: false,
        },
        {
          key: 'cash',
          label: 'Pay at pickup',
          description: 'Pay in person.',
          is_sandbox: false,
          offline: true,
        },
      ]),
    ),
  );
});

describe('settings logic', () => {
  it('diffs only changed fields and keeps providers the server cannot run out of the form', () => {
    const saved = settingsToValues(settings() as never);
    expect(saved.allowed_checkout_methods).toEqual(['demo', 'cash']);
    expect(diffSettings(saved, { ...saved })).toEqual({});
    expect(diffSettings(saved, { ...saved, tax_rate: '9', currency: 'eur' })).toEqual({
      tax_rate: '9.00',
      currency: 'EUR',
    });
    expect(taxFieldsChanged(saved, { ...saved, tax_label: 'VAT' })).toBe(true);
    expect(taxFieldsChanged(saved, { ...saved, tagline: 'x' })).toBe(false);
  });
});

describe('settings page', () => {
  it('shows the placeholder-tax notice and demands confirmation before changing tax', async () => {
    renderApp('/admin/settings');
    expect(await screen.findByText('Confirm your legal tax requirements')).toBeInTheDocument();
    expect(screen.getByText(/placeholder/, { selector: 'strong' })).toBeInTheDocument();
    const rate = screen.getByLabelText(/^Tax rate/);
    await userEvent.clear(rate);
    await userEvent.type(rate, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      await screen.findByText(
        'Confirm that these tax and currency settings meet your legal requirements.',
      ),
    ).toBeInTheDocument();
    expect(patches).toHaveLength(0);

    await userEvent.click(screen.getByRole('checkbox', { name: /I have checked that these tax/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(patches).toEqual([{ tax_rate: '9.00' }]));
  });

  it('does not ask for tax confirmation for unrelated changes', async () => {
    renderApp('/admin/settings');
    const tagline = await screen.findByLabelText('Tagline');
    await userEvent.clear(tagline);
    await userEvent.type(tagline, 'Fresh daily');
    expect(
      screen.queryByRole('checkbox', { name: /I have checked that these tax/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(patches).toEqual([{ tagline: 'Fresh daily' }]));
  });

  it('pauses ordering only after a confirmation, then shows the paused banner and a resume button', async () => {
    renderApp('/admin/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Pause all ordering' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pause all ordering?' });
    expect(patches).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause all ordering' }));
    await waitFor(() => expect(patches).toEqual([{ ordering_enabled: false }]));
    expect(await screen.findByText('Ordering is paused for the whole store')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume ordering' }));
    await waitFor(() => expect(patches.at(-1)).toEqual({ ordering_enabled: true }));
  });

  it('lists payment methods from the API with the sandbox flagged, and is honest about Stripe', async () => {
    renderApp('/admin/settings');
    expect(await screen.findByText('Sandbox — no real money')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Sandbox payment/ })).toBeChecked();
    expect(screen.getByText(/Card payments \(Stripe\):/)).toHaveTextContent('not enabled');
    expect(screen.getByText(/secret and webhook keys set on the server/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Sandbox payment/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(patches).toEqual([{ allowed_checkout_methods: ['cash'] }]));
  });

  it('blocks saving with no payment method at all', async () => {
    renderApp('/admin/settings');
    await userEvent.click(await screen.findByRole('checkbox', { name: /Sandbox payment/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Pay at pickup/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/Keep at least one payment method/)).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });
});
