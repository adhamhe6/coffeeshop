import { Tag } from 'lucide-react';
import { Money } from '@/design';
import type { CartPreview } from '@/lib/api/checkout';
import { cn } from '@/lib/cn';

function Row({
  label,
  children,
  strong,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', className)}>
      <dt className={cn(strong ? 'font-semibold' : 'text-text-muted')}>{label}</dt>
      <dd className={cn('text-right tabular-nums', strong && 'font-display text-xl font-semibold')}>
        {children}
      </dd>
    </div>
  );
}

const isZero = (value: string | undefined | null) => value === undefined || Number(value) === 0;

/**
 * The server's pricing breakdown, shown exactly as returned: nothing here is added up on the client.
 * Fees are never hidden: pickup says "none", delivery without an address says it is worked out at checkout.
 */
export function PriceBreakdown({
  preview,
  estimate = false,
  className,
}: {
  preview: CartPreview;
  /** Cart page: delivery/tax may still change once the order type and branch are chosen. */
  estimate?: boolean;
  className?: string;
}) {
  const delivery = preview.order_type === 'DELIVERY';
  return (
    <dl className={cn('grid gap-2.5 text-[0.9375rem]', className)} data-testid="price-breakdown">
      <Row label="Subtotal">
        <Money value={preview.subtotal} />
      </Row>
      {!isZero(preview.discount_total) || preview.coupon ? (
        <Row
          label={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              Discount
              {preview.coupon ? (
                <span className="inline-flex items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-text">
                  <Tag aria-hidden="true" className="size-3" />
                  {preview.coupon.is_automatic ? preview.coupon.name : preview.coupon.code}
                </span>
              ) : null}
            </span>
          }
        >
          <span className="text-success">
            −<Money value={preview.discount_total} />
          </span>
        </Row>
      ) : null}
      <Row label={delivery ? 'Delivery fee' : 'Delivery'}>
        {delivery ? (
          preview.delivery ? (
            isZero(preview.delivery_fee) ? (
              'Free'
            ) : (
              <Money value={preview.delivery_fee} />
            )
          ) : (
            <span className="text-text-muted">Set by your address</span>
          )
        ) : (
          <span className="text-text-muted">None for pickup</span>
        )}
      </Row>
      <Row
        label={
          <>
            {preview.tax_label || 'Tax'}
            {!isZero(preview.tax_rate) ? ` (${Number(preview.tax_rate)}%)` : ''}
          </>
        }
      >
        {preview.prices_include_tax ? (
          <span>
            <span className="text-text-muted">Included · </span>
            <Money value={preview.tax_total} />
          </span>
        ) : (
          <Money value={preview.tax_total} />
        )}
      </Row>
      <Row
        label={estimate ? 'Estimated total' : 'Total'}
        strong
        className="mt-1 border-t border-border pt-3"
      >
        <Money value={preview.total} />
      </Row>
    </dl>
  );
}
