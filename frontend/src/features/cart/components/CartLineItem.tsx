import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Pencil, StickyNote, Trash2, TriangleAlert, TrendingUp } from 'lucide-react';
import {
  Badge,
  Button,
  IconButton,
  Money,
  ProductImage,
  QuantityStepper,
  Textarea,
  toast,
} from '@/design';
import { useRemoveCartItem, useUpdateCartItem } from '@/lib/api/cart';
import { describeError } from '@/lib/api/errors';
import { useAcknowledgePrices, useUpdateCartNote } from '@/lib/api/checkout';
import type { CartItem } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { OptionChips } from './OptionChips';

/** How long to wait after the last click on +/− before sending the PATCH. */
export const QUANTITY_DEBOUNCE_MS = 450;

/**
 * Quantity that responds instantly and is saved once the customer stops clicking.
 * Pending changes are flushed (not dropped) if the line unmounts first.
 */
function useDebouncedQuantity(item: CartItem) {
  const update = useUpdateCartItem();
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const queued = useRef<number | null>(null);
  const itemId = item.id;
  const mutate = update.mutate;

  const send = (quantity: number) => {
    mutate(
      { id: itemId, quantity },
      {
        onError: (error) => toast.error(describeError(error).message),
        onSettled: () => setPending((p) => (p === quantity ? null : p)),
      },
    );
  };

  const change = (quantity: number) => {
    setPending(quantity);
    queued.current = quantity;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      queued.current = null;
      send(quantity);
    }, QUANTITY_DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (timer.current !== null && queued.current !== null) {
        window.clearTimeout(timer.current);
        mutate({ id: itemId, quantity: queued.current });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId],
  );

  return {
    quantity: pending ?? item.quantity,
    saving: pending !== null || update.isPending,
    change,
  };
}

function LineNote({ item, compact }: { item: CartItem; compact: boolean }) {
  const save = useUpdateCartNote();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.note);

  if (!editing) {
    return item.note ? (
      <p className="flex items-start gap-1.5 text-sm text-text-muted">
        <StickyNote aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 italic">“{item.note}”</span>
        <button
          type="button"
          className="shrink-0 rounded-xs text-accent-text underline underline-offset-4"
          onClick={() => {
            setDraft(item.note);
            setEditing(true);
          }}
          aria-label={`Edit note for ${item.product.name}`}
        >
          Edit
        </button>
      </p>
    ) : compact ? null : (
      <button
        type="button"
        className="w-fit rounded-xs text-sm text-accent-text underline underline-offset-4"
        onClick={() => {
          setDraft('');
          setEditing(true);
        }}
        aria-label={`Add a note to ${item.product.name}`}
      >
        Add a note
      </button>
    );
  }

  const commit = () => {
    const note = draft.trim();
    if (note === item.note) {
      setEditing(false);
      return;
    }
    save.mutate(
      { id: item.id, note },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success('Note saved.');
        },
        onError: (error) => toast.error(describeError(error).message),
      },
    );
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <Textarea
        aria-label={`Note for ${item.product.name}`}
        rows={2}
        maxLength={200}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Anything we should know? e.g. extra hot"
        className="min-h-16"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>
          Save note
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface CartLineItemProps {
  item: CartItem;
  /** `sheet` is the narrow side panel: smaller image, no inline note editor. */
  variant?: 'page' | 'sheet';
  onNavigate?: () => void;
}

export function CartLineItem({ item, variant = 'page', onNavigate }: CartLineItemProps) {
  const remove = useRemoveCartItem();
  const acknowledge = useAcknowledgePrices();
  const { quantity, saving, change } = useDebouncedQuantity(item);
  const compact = variant === 'sheet';

  const unavailable =
    item.product.is_available === false || item.issues.some((i) => i.severity === 'error');
  const errors = item.issues.filter((i) => i.severity === 'error');
  const warnings = item.issues.filter((i) => i.severity !== 'error' && i.code !== 'price_changed');

  return (
    <li
      className={cn('flex gap-3.5 py-5', unavailable && 'bg-danger-bg/30')}
      aria-busy={saving || undefined}
      data-testid="cart-line"
      data-unavailable={unavailable || undefined}
    >
      <Link
        to={`/p/${item.product.slug}`}
        onClick={onNavigate}
        className="shrink-0 self-start"
        tabIndex={-1}
        aria-hidden="true"
      >
        <ProductImage
          src={item.product.image}
          alt=""
          aspect="1/1"
          className={cn(compact ? 'size-20' : 'size-24 sm:size-28', unavailable && 'opacity-60')}
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={`/p/${item.product.slug}`}
              onClick={onNavigate}
              className="block rounded-xs font-medium underline-offset-4 hover:underline"
            >
              {item.product.name}
            </Link>
            <p className="mt-0.5 text-sm text-text-muted">
              <Money value={item.unit_price} /> each
            </p>
          </div>
          <Money
            value={item.line_total}
            className={cn('shrink-0 font-medium', saving && 'opacity-60')}
          />
        </div>

        <OptionChips options={item.options} />
        <LineNote item={item} compact={compact} />

        {unavailable ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-bg p-2.5 text-sm font-medium text-danger"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <Badge tone="danger" size="sm" className="mb-1">
                Unavailable
              </Badge>
              {errors.length > 0 ? (
                errors.map((issue) => <p key={`${issue.code}-${issue.message}`}>{issue.message}</p>)
              ) : (
                <p>This item is no longer available. Remove it to continue.</p>
              )}
            </div>
          </div>
        ) : null}

        {warnings.map((issue) => (
          <p
            key={`${issue.code}-${issue.message}`}
            className="flex items-start gap-1.5 text-sm font-medium text-warning"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {issue.message}
          </p>
        ))}

        {item.price_changed ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning-bg p-2.5 text-sm text-warning"
          >
            <span className="flex items-start gap-2 font-medium">
              <TrendingUp aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                Price changed from <Money value={item.price_changed.was} /> to{' '}
                <Money value={item.price_changed.now} /> each.
              </span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={acknowledge.isPending}
              onClick={() =>
                acknowledge.mutate(undefined, {
                  onSuccess: () => toast.success('New prices accepted.'),
                  onError: (error) => toast.error(describeError(error).message),
                })
              }
            >
              Accept new prices
            </Button>
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <QuantityStepper
            size={compact ? 'sm' : 'md'}
            value={quantity}
            itemLabel={item.product.name}
            onChange={change}
          />
          <div className="flex items-center gap-1">
            {!unavailable ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className={cn(!compact && 'max-sm:h-11')}
                onClick={onNavigate}
              >
                <Link
                  to={`/p/${item.product.slug}?edit=${item.id}`}
                  aria-label={`Edit ${item.product.name}`}
                >
                  <Pencil aria-hidden="true" className="size-4" /> Edit
                </Link>
              </Button>
            ) : null}
            <IconButton
              label={`Remove ${item.product.name}`}
              variant="ghost"
              size="icon-sm"
              className={cn(!compact && 'max-sm:size-11')}
              icon={<Trash2 aria-hidden="true" className="size-4" />}
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(item.id, {
                  onSuccess: () => toast.success(`${item.product.name} removed from your cart.`),
                  onError: (error) => toast.error(describeError(error).message),
                })
              }
            />
          </div>
        </div>
      </div>
    </li>
  );
}
