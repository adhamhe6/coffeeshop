import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderWithProviders, resetTestWorld } from '@/test/utils';
import {
  API,
  apiError,
  CAPS,
  mockCatalogApi,
  paged,
  review,
  signInAs,
} from '../catalog-kit/testing';
import AdminReviewsPage from './pages/ReviewsPage';

beforeEach(() => resetTestWorld());

function setup(role = CAPS.productManager) {
  signInAs(role);
  mockCatalogApi();
  const reviews = [
    review({ id: 1 }),
    review({
      id: 2,
      customer: { id: 3, name: 'Sam', email: 's@example.com' },
      is_demo: false,
      title: 'Fine',
    }),
  ];
  server.use(
    http.get(`${API}/admin/reviews/`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      return HttpResponse.json(paged(reviews.filter((r) => !status || r.status === status)));
    }),
  );
  return reviews;
}

describe('reviews moderation', () => {
  it('shows the pending queue first with demo reviews labelled', async () => {
    setup();
    renderWithProviders(<AdminReviewsPage />);
    expect(await screen.findByText('Demo review')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: /Pending/, selected: true })).toBeInTheDocument();
  });

  it('approving removes the review from the pending list immediately and keeps it after the server confirms', async () => {
    const reviews = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.post(`${API}/admin/reviews/1/approve/`, async () => {
        await gate;
        reviews[0]!.status = 'APPROVED';
        return HttpResponse.json(reviews[0]);
      }),
    );
    renderWithProviders(<AdminReviewsPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve review by Alex Morgan' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Approve review by Alex Morgan' }),
      ).not.toBeInTheDocument(),
    );
    release();
    expect(
      await screen.findByText(/Review of Espresso approved and now public/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve review by Sam' })).toBeInTheDocument();
  });

  it('restores the review and explains when rejecting fails', async () => {
    setup();
    server.use(
      http.post(`${API}/admin/reviews/1/reject/`, () =>
        apiError(403, 'forbidden', 'You do not have permission to perform this action.'),
      ),
    );
    renderWithProviders(<AdminReviewsPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reject review by Alex Morgan' }),
    );
    expect(
      await screen.findByText(/Could not update the review by Alex Morgan/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Reject review by Alex Morgan' }),
    ).toBeInTheDocument();
  });

  it('shows no moderation buttons without reviews.moderate', async () => {
    setup(CAPS.orderManager);
    renderWithProviders(<AdminReviewsPage />);
    await screen.findAllByText('Lovely', { exact: false });
    expect(screen.queryByRole('button', { name: /Approve review/ })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Reviews' });
    expect(within(list).getAllByRole('listitem').length).toBe(2);
  });
});
