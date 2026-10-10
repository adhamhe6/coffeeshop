import { Button, Dialog, DialogContent, DialogFooter, Money } from '@/design';
import { PriceBreakdown } from '@/features/cart/components/PriceBreakdown';
import type { CartPreview } from '@/lib/api/checkout';

/** 409 `price_changed`: show exactly what changed and let the customer accept the new total or go back. */
export function PriceChangedDialog({
  open,
  previousTotal,
  preview,
  busy,
  onAccept,
  onReview,
}: {
  open: boolean;
  previousTotal: string | undefined;
  preview: CartPreview | null;
  busy: boolean;
  onAccept: () => void;
  onReview: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onReview()}>
      <DialogContent
        title="Your total has changed"
        description="Prices or discounts changed since you last looked. Nothing has been charged."
      >
        <div className="grid gap-4">
          {preview ? (
            <>
              <div className="flex items-baseline justify-between gap-4 rounded-md bg-surface-sunken p-3.5 text-sm">
                <span className="text-text-muted">Previous total</span>
                <Money value={previousTotal} className="font-medium line-through" />
              </div>
              {preview.items
                .filter((i) => i.price_changed)
                .map((item) => (
                  <p key={item.id} className="text-sm">
                    <span className="font-medium">{item.product.name}</span> now costs{' '}
                    <Money value={item.unit_price} /> each
                    {item.price_changed ? (
                      <>
                        {' '}
                        (was <Money value={item.price_changed.was} />)
                      </>
                    ) : null}
                    .
                  </p>
                ))}
              <PriceBreakdown preview={preview} />
            </>
          ) : (
            <p className="text-sm">Review your order to see the new total.</p>
          )}
        </div>
        <DialogFooter className="-mx-6 mt-5 -mb-5">
          <Button variant="secondary" onClick={onReview}>
            Review order
          </Button>
          <Button
            onClick={onAccept}
            loading={busy}
            loadingText="Placing your order…"
            disabled={!preview}
          >
            Accept new total and place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
