import { expect, test } from '@playwright/test';
import {
  addLatteToCart,
  collectErrors,
  completePickupDetails,
  placeOrder,
  registerAtCheckout,
  uniqueEmail,
} from './helpers-commerce';

/**
 * A declined sandbox payment gives clear feedback, can be retried to success, and replaying the completion of a
 * settled payment can never charge twice.
 */
test('decline → clear feedback → retry → success; replaying completion does not double-charge', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await addLatteToCart(page);
  await registerAtCheckout(page, uniqueEmail('retry'));
  await completePickupDetails(page);
  await placeOrder(page);

  // 1. First attempt: card declined.
  await expect(page).toHaveURL(/\/pay\/demo\/(demo_[^/?]+)/);
  const firstReference = page.url().match(/\/pay\/demo\/([^/?]+)/)?.[1] ?? '';
  await page.getByRole('button', { name: 'Simulate card declined' }).click();

  await expect(page).toHaveURL(/\/orders\/[^/?]+\?payment=failed/);
  const notice = page.getByRole('alert').filter({ hasText: 'Payment declined' });
  await expect(notice).toContainText('Nothing was charged');
  await expect(page.getByTestId('order-number')).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())?.trim() ?? '';
  await expect(page.getByText('Payment failed').first()).toBeVisible();

  // 2. The failed session cannot be reused.
  await page.goto(`/pay/demo/${firstReference}`);
  await expect(page.getByText(/already failed/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simulate successful payment' })).toHaveCount(0);

  // 3. Retry from the order page → new sandbox session → success.
  await page.goto(`/orders/${number}`);
  await page.getByRole('button', { name: 'Try payment again' }).click();
  await expect(page).toHaveURL(/\/pay\/demo\/demo_/, { timeout: 20_000 });
  const secondReference = page.url().match(/\/pay\/demo\/([^/?]+)/)?.[1] ?? '';
  expect(secondReference).not.toBe(firstReference);
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(page.getByTestId('confirmation-title')).toContainText('Your order is in');
  await expect(page.getByText('Paid').first()).toBeVisible();

  // 4. Replaying the completion of the settled payment changes nothing: the same outcome is a no-op,
  //    a contradicting one is refused.
  const complete = (outcome: string) =>
    page.evaluate(
      async ({ reference, outcome }) => {
        const csrf =
          document.cookie
            .split('; ')
            .find((c) => c.startsWith('lantern_csrftoken='))
            ?.split('=')[1] ?? '';
        const res = await fetch(`/api/v1/payments/demo/${reference}/complete/`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
          body: JSON.stringify({ outcome }),
        });
        return {
          status: res.status,
          body: (await res.json()) as { event_outcome?: string; error?: { code: string } },
        };
      },
      { reference: secondReference, outcome },
    );
  const again = await complete('success');
  expect(again.status).toBe(200);
  expect(again.body.event_outcome).not.toBe('applied');
  const contradicting = await complete('decline');
  expect(contradicting.status).toBe(409);
  expect(contradicting.body.error?.code).toBe('payment_not_pending');

  await page.goto(`/orders/${number}`);
  await expect(page.getByText('Paid').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Try payment again|Pay now/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
