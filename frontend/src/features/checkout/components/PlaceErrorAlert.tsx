import { forwardRef } from 'react';
import { Link } from 'react-router';
import { PackageX, TriangleAlert, WifiOff } from 'lucide-react';
import { Button } from '@/design';
import type { PlaceError } from '../placeError';

/** Top-of-form result of a failed attempt. Focused and announced so keyboard and screen-reader users land on it. */
export const PlaceErrorAlert = forwardRef<HTMLDivElement, { error: PlaceError | null }>(
  function PlaceErrorAlert({ error }, ref) {
    if (!error || error.kind === 'price_changed') return null;
    const Icon =
      error.kind === 'network' ? WifiOff : error.kind === 'out_of_stock' ? PackageX : TriangleAlert;
    return (
      <div
        ref={ref}
        role="alert"
        tabIndex={-1}
        data-testid="place-error"
        className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-bg p-4 text-danger outline-none"
      >
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div className="grid gap-2 text-sm">
          <p className="font-semibold">
            {error.kind === 'network'
              ? 'Connection problem'
              : error.kind === 'out_of_stock'
                ? 'Some items are no longer available in that quantity'
                : error.kind === 'auth'
                  ? 'Please sign in again'
                  : 'We could not place your order'}
          </p>
          <p className="font-medium">{error.message}</p>
          {error.kind === 'out_of_stock' && error.items.length > 0 ? (
            <ul className="list-disc pl-5">
              {error.items.map((item) => (
                <li key={`${item.product_id ?? item.name}`}>
                  {item.name}
                  {item.available !== undefined
                    ? item.available > 0
                      ? ` — only ${item.available} left (you asked for ${item.requested ?? '?'})`
                      : ' — sold out here'
                    : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {error.kind === 'out_of_stock' || error.kind === 'cart_empty' ? (
            <div>
              <Button asChild variant="secondary" size="sm">
                <Link to="/cart">Review your cart</Link>
              </Button>
            </div>
          ) : null}
          {error.kind === 'generic' && error.requestId ? (
            <p className="text-xs font-normal">Reference: {error.requestId}</p>
          ) : null}
        </div>
      </div>
    );
  },
);
