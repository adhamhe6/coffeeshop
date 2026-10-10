import { useState, type ReactNode } from 'react';
import { ChevronUp, Info } from 'lucide-react';
import { Button, Money, ProductImage, Sheet, SheetContent, Skeleton } from '@/design';
import { OptionChips } from '@/features/cart/components/OptionChips';
import { PriceBreakdown } from '@/features/cart/components/PriceBreakdown';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { CartPreview } from '@/lib/api/checkout';

export interface FulfilmentLine {
  label: string;
  value: ReactNode;
}

interface OrderSummaryProps {
  preview: CartPreview | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  lines: FulfilmentLine[];
  /** Short explanation shown when the button is disabled. */
  hint?: ReactNode;
  placing: boolean;
  /** `false` blocks the button (server blockers, unavailable items…). */
  canPlace: boolean;
  onPlace: () => void;
  notice?: ReactNode;
}

function Lines({ preview }: { preview: CartPreview }) {
  return (
    <ul className="grid gap-3" aria-label="Items in this order">
      {preview.items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <ProductImage src={item.product.image} alt="" aspect="1/1" className="size-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {item.quantity} × {item.product.name}
            </p>
            <OptionChips options={item.options} />
          </div>
          <Money value={item.line_total} className="shrink-0 text-sm" />
        </li>
      ))}
    </ul>
  );
}

function Body({ preview, loading, failed, onRetry, lines }: OrderSummaryProps) {
  return (
    <div className="grid gap-5">
      {lines.length > 0 ? (
        <dl className="grid gap-1.5 text-sm" data-testid="fulfilment-summary">
          {lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4">
              <dt className="text-text-muted">{line.label}</dt>
              <dd className="text-right font-medium">{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {preview ? <Lines preview={preview} /> : null}
      <div className="border-t border-border pt-5" aria-live="polite">
        {preview ? (
          <PriceBreakdown preview={preview} />
        ) : failed ? (
          <div className="grid gap-3">
            <p role="alert" className="text-sm font-medium text-danger">
              We could not work out your total. Your choices are kept.
            </p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : loading ? (
          <div className="grid gap-2.5" aria-busy="true">
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
            <Skeleton className="h-6" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlaceButton({
  props,
  total,
  className,
}: {
  props: OrderSummaryProps;
  total: string | undefined;
  className?: string;
}) {
  return (
    <Button
      size="lg"
      block
      className={className}
      loading={props.placing}
      loadingText="Placing your order…"
      disabled={!props.canPlace}
      aria-disabled={!props.canPlace || undefined}
      onClick={props.onPlace}
    >
      Place order
      {total ? (
        <>
          {' '}
          · <Money value={total} />
        </>
      ) : null}
    </Button>
  );
}

/**
 * Live order summary. Desktop: sticky right column. Mobile: a fixed bar with the total that expands into a
 * sheet with the full breakdown. Exactly one variant is mounted at a time.
 */
export function OrderSummary(props: OrderSummaryProps) {
  const isWide = useMediaQuery('(min-width: 1024px)');
  const [open, setOpen] = useState(false);
  const total = props.preview?.total;

  if (isWide) {
    return (
      <aside
        aria-label="Order summary"
        className="sticky top-[calc(var(--header-h)+1.5rem)] rounded-lg border border-border bg-surface-raised p-6"
      >
        <h2 className="mb-5 font-display text-h4 font-semibold">Your order</h2>
        <Body {...props} />
        <div className="mt-6 grid gap-3">
          {props.notice}
          <PlaceButton props={props} total={total} />
          {!props.canPlace && props.hint ? (
            <p className="flex items-start gap-1.5 text-sm text-text-muted">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {props.hint}
            </p>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised px-[var(--gutter)] pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-md"
        data-testid="mobile-summary-bar"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-summary-sheet"
            onClick={() => setOpen(true)}
            className="flex min-h-11 min-w-0 flex-1 flex-col items-start rounded-md text-left"
          >
            <span className="flex items-center gap-1 text-xs text-text-muted">
              Total · view details <ChevronUp aria-hidden="true" className="size-3.5" />
            </span>
            {total ? (
              <Money value={total} className="font-display text-xl leading-tight font-semibold" />
            ) : (
              <span className="text-sm text-text-muted">Calculating…</span>
            )}
          </button>
          <PlaceButton props={props} total={undefined} className="w-auto flex-none" />
        </div>
        {!props.canPlace && props.hint ? (
          <p className="mx-auto mt-1.5 flex max-w-3xl items-start gap-1.5 text-xs text-text-muted">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> {props.hint}
          </p>
        ) : null}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" title="Your order" description="Items, fees, tax and total.">
          <div id="mobile-summary-sheet" className="p-5">
            <Body {...props} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
