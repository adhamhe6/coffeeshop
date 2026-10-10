import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { isApiError } from '@/lib/api/errors';
import { useAddToCart } from '@/lib/api/cart';
import type { CartItem, ModifierGroup, ProductDetail } from '@/lib/api/types';
import { useCartSheet } from '@/features/cart/components/CartSheet';
import {
  Badge,
  Button,
  Money,
  QuantityStepper,
  RadioCard,
  RadioGroup,
  Skeleton,
  Textarea,
  toast,
} from '@/design';
import { useQuote, useReconfigureCartItem, type Quote } from '../api';
import {
  defaultSelection,
  groupRule,
  maxFor,
  optionIds,
  selectionFromCartItem,
  setSingle,
  toggleOption,
  validateSelection,
  type Selection,
} from '../customiser';
import { useSelectedBranch } from '../useSelectedBranch';
import { unavailableText } from '../availability';

const NONE = 'none';

interface CustomiserProps {
  product: ProductDetail;
  /** Existing cart line to edit (`/p/:slug?edit=<id>`): preloads options/quantity/note and PATCHes instead of POSTing. */
  editItem?: CartItem;
  /** `page` pins the add bar to the bottom on phones; `dialog` keeps everything inside the dialog's scroll area. */
  layout?: 'page' | 'dialog';
  /** Called after a successful add/update (closing the dialog, etc.). */
  onDone?: () => void;
  className?: string;
}

function GroupSection({
  group,
  selection,
  onChange,
  problem,
}: {
  group: ModifierGroup;
  selection: Selection;
  onChange: (next: Selection) => void;
  problem: string | undefined;
}) {
  const headingId = useId();
  const picked = selection[group.id] ?? [];
  const max = maxFor(group);
  const atMax = group.selection_type === 'MULTIPLE' && picked.length >= max;
  // A single optional option (e.g. "Swap to decaf") reads better as a switch-like checkbox than a radio.
  const asToggle =
    group.selection_type === 'SINGLE' && !group.is_required && group.options.length === 1;
  const singleCards = group.selection_type === 'SINGLE' && !asToggle;

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="font-display text-[1.125rem] font-medium">
          {group.display_name}
          {group.is_required ? (
            <Badge tone="neutral" size="sm" className="ml-2 align-middle font-sans">
              Required
            </Badge>
          ) : null}
        </h2>
        <p className="text-sm text-text-muted">
          {groupRule(group)}
          {group.selection_type === 'MULTIPLE' ? (
            <span aria-live="polite"> · {picked.length} selected</span>
          ) : null}
        </p>
      </div>

      {singleCards ? (
        <RadioGroup
          aria-labelledby={headingId}
          value={picked[0] ? String(picked[0]) : NONE}
          onValueChange={(v) =>
            onChange(setSingle(group, selection, v === NONE ? null : Number(v)))
          }
          className="grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2.5"
        >
          {group.is_required ? null : (
            <RadioCard
              value={NONE}
              title={`No ${group.display_name.toLowerCase()}`}
              className="p-3.5"
            />
          )}
          {group.options.map((o) => (
            <RadioCard
              key={o.id}
              value={String(o.id)}
              disabled={o.is_available === false}
              title={o.name}
              description={o.is_available === false ? 'Unavailable' : undefined}
              meta={
                Number(o.price_delta) !== 0 ? <Money value={o.price_delta} signed /> : undefined
              }
              className="p-3.5"
            />
          ))}
        </RadioGroup>
      ) : (
        <div
          role="group"
          aria-labelledby={headingId}
          className={cn('grid gap-2.5', group.options.length > 3 && 'sm:grid-cols-2')}
        >
          {group.options.map((o) => {
            const checked = picked.includes(o.id);
            const disabled = o.is_available === false || (atMax && !checked);
            return (
              <label
                key={o.id}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 transition-[border-color,background-color,box-shadow] hover:border-text',
                  'has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:bg-accent-soft has-[[data-state=checked]]:shadow-[inset_0_0_0_1px_var(--color-accent)]',
                  disabled && 'cursor-not-allowed opacity-55 hover:border-border-strong',
                )}
              >
                <CheckboxPrimitive.Root
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => onChange(toggleOption(group, selection, o.id))}
                  className="flex size-5 shrink-0 items-center justify-center rounded-xs border border-border-strong bg-surface-raised text-accent-foreground data-[state=checked]:border-accent data-[state=checked]:bg-accent"
                >
                  <CheckboxPrimitive.Indicator>
                    <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
                  </CheckboxPrimitive.Indicator>
                </CheckboxPrimitive.Root>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{o.name}</span>
                  {o.is_available === false ? (
                    <span className="block text-sm text-text-muted">Unavailable</span>
                  ) : atMax && !checked ? (
                    <span className="block text-sm text-text-muted">Maximum of {max} reached</span>
                  ) : null}
                </span>
                {Number(o.price_delta) !== 0 ? (
                  <Money value={o.price_delta} signed className="text-sm font-medium" />
                ) : null}
              </label>
            );
          })}
        </div>
      )}
      {problem ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {problem}
        </p>
      ) : null}
    </section>
  );
}

/** Server-computed price breakdown (`products/{slug}/quote/`). Dims while a newer quote is loading. */
export function PriceBreakdown({
  quote,
  loading,
  failed,
  onRetry,
}: {
  quote: Quote | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (!quote) {
    return failed ? (
      <div role="alert" className="rounded-lg border border-border bg-surface-raised p-4 text-sm">
        <p className="text-danger">We could not calculate the price.</p>
        <Button variant="link" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      </div>
    ) : (
      <div
        className="grid gap-2.5 rounded-lg border border-border bg-surface-raised p-4"
        aria-busy="true"
        aria-label="Calculating price"
      >
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }
  const extras = quote.options.filter((o) => Number(o.price_delta) !== 0);
  return (
    <dl
      aria-label="Price breakdown"
      aria-busy={loading || undefined}
      className={cn(
        'grid gap-1.5 rounded-lg border border-border bg-surface-raised p-4 text-[0.9375rem] transition-opacity',
        loading && 'opacity-60',
      )}
    >
      <div className="flex justify-between gap-4">
        <dt className="text-text-muted">Base price</dt>
        <dd>
          <Money value={quote.base_price} />
        </dd>
      </div>
      {extras.map((o, i) => (
        <div key={`${o.group}-${o.name}-${i}`} className="flex justify-between gap-4">
          <dt className="text-text-muted">
            {o.name} <span className="text-xs">({o.group})</span>
          </dt>
          <dd>
            <Money value={o.price_delta} signed />
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-border pt-1.5">
        <dt className="font-medium">Price each</dt>
        <dd className="font-medium">
          <Money value={quote.unit_price} />
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-text-muted">Quantity</dt>
        <dd>× {quote.quantity}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
        <dt className="font-display text-lg font-medium">Total</dt>
        <dd className="font-display text-xl font-semibold">
          <Money value={quote.line_total} />
        </dd>
      </div>
    </dl>
  );
}

export function Customiser({
  product,
  editItem,
  layout = 'page',
  onDone,
  className,
}: CustomiserProps) {
  const groups = useMemo(() => product.modifier_groups ?? [], [product.modifier_groups]);
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { setOpen: setCartOpen } = useCartSheet();
  const { branch, branchId } = useSelectedBranch();
  const addToCart = useAddToCart();
  const reconfigure = useReconfigureCartItem();

  const [selection, setSelection] = useState<Selection>(() =>
    editItem ? selectionFromCartItem(groups, editItem.options) : defaultSelection(groups),
  );
  const [quantity, setQuantity] = useState(editItem?.quantity ?? 1);
  const [note, setNote] = useState(editItem?.note ?? '');
  // A failed submit stays visible until the configuration changes.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const noteId = useId();

  const ids = optionIds(groups, selection);
  const requestKey = JSON.stringify({ o: ids, q: quantity, b: branchId ?? null });
  const debouncedKey = useDebouncedValue(requestKey, 250);
  const request = useMemo(() => {
    const d = JSON.parse(debouncedKey) as { o: number[]; q: number; b: number | null };
    return { option_ids: d.o, quantity: d.q, ...(d.b ? { branch_id: d.b } : {}) };
  }, [debouncedKey]);
  const quoteQuery = useQuote(product.slug, request);
  const settling = debouncedKey !== requestKey || quoteQuery.isFetching;
  const quote = quoteQuery.data;
  const quoteIsCurrent = Boolean(quote) && !settling && !quoteQuery.isPlaceholderData;

  const problems = validateSelection(groups, selection);
  const problemByGroup = new Map(problems.map((p) => [p.groupId, p.message]));
  const unavailable =
    product.is_available === false ? unavailableText(product, branch?.name) : null;
  const serverErrors = quoteIsCurrent && quote && !quote.valid ? quote.errors : [];

  // Explanation shown (and announced) while the button is disabled.
  const blocker =
    unavailable ?? problems[0]?.message ?? (serverErrors[0] ? serverErrors[0].message : null);

  const submitError = failure && failure.key === `${requestKey}|${note}` ? failure.message : null;
  const busy = addToCart.isPending || reconfigure.isPending;
  const editing = Boolean(editItem);

  const afterSuccess = () => {
    onDone?.();
    if (isDesktop) window.setTimeout(() => setCartOpen(true), 0);
  };

  const submit = async () => {
    if (blocker || busy) return;
    setFailure(null);
    try {
      if (editItem) {
        await reconfigure.mutateAsync({
          id: editItem.id,
          quantity,
          option_ids: ids,
          note: note.trim(),
        });
        toast.success(`Updated ${product.name} in your cart`);
        onDone?.();
        navigate('/cart');
        return;
      }
      await addToCart.mutateAsync({
        product_id: product.id,
        quantity,
        option_ids: ids,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(`Added ${quantity > 1 ? `${quantity} × ` : ''}${product.name} to your cart`, {
        action: {
          label: 'View cart',
          onClick: () => (isDesktop ? setCartOpen(true) : navigate('/cart')),
        },
      });
      afterSuccess();
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : 'We could not update your cart. Please try again.';
      setFailure({ key: `${requestKey}|${note}`, message });
      toast.error(message);
    }
  };

  const actionLabel = editing ? 'Update cart item' : 'Add to cart';

  return (
    <form
      className={cn('grid grid-cols-[minmax(0,1fr)] gap-7', className)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      {groups.map((g) => (
        <GroupSection
          key={g.id}
          group={g}
          selection={selection}
          problem={problemByGroup.get(g.id)}
          onChange={setSelection}
        />
      ))}

      <div className="grid gap-1.5">
        <label htmlFor={noteId} className="text-sm font-medium">
          Note <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <Textarea
          id={noteId}
          rows={2}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            product.product_type === 'BEVERAGE'
              ? 'Extra hot, no lid, name for the cup…'
              : 'Anything we should know?'
          }
          className="min-h-16"
        />
        <p className="text-right text-xs text-text-muted tabular-nums">{note.length}/200</p>
      </div>

      <PriceBreakdown
        quote={quote}
        loading={settling}
        failed={quoteQuery.isError}
        onRetry={() => void quoteQuery.refetch()}
      />

      <div
        className={cn(
          'grid gap-3',
          layout === 'dialog' &&
            'sticky bottom-0 z-10 -mx-5 -mb-5 border-t border-border bg-surface-raised px-5 py-3 md:-mx-6 md:px-6',
          layout === 'page' &&
            'max-lg:sticky max-lg:bottom-0 max-lg:z-30 max-lg:-mx-[var(--gutter)] max-lg:border-t max-lg:border-border max-lg:bg-surface/95 max-lg:px-[var(--gutter)] max-lg:py-3 max-lg:backdrop-blur-md',
        )}
      >
        <div className="flex items-center gap-3">
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            itemLabel={product.name}
            disabled={Boolean(unavailable)}
          />
          <Button
            type="submit"
            size="lg"
            className="min-w-0 flex-1 px-4"
            disabled={Boolean(blocker)}
            loading={busy}
            loadingText={editing ? 'Updating…' : 'Adding…'}
            aria-describedby={blocker || submitError ? `${noteId}-status` : undefined}
          >
            {actionLabel}
            {quote && quoteIsCurrent ? (
              <>
                <span aria-hidden="true">·</span>
                <Money value={quote.line_total} />
              </>
            ) : null}
          </Button>
        </div>
        <p
          id={`${noteId}-status`}
          role="status"
          className={cn(
            'min-h-5 text-sm',
            blocker || submitError ? 'font-medium text-danger' : 'sr-only',
          )}
        >
          {submitError ?? blocker ?? ''}
        </p>
      </div>
    </form>
  );
}
