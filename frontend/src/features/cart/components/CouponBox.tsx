import { useId, useState } from 'react';
import { CircleCheck, TicketPercent, TriangleAlert, X } from 'lucide-react';
import { Button, Input, Money, toast } from '@/design';
import { describeError, isApiError } from '@/lib/api/errors';
import { checkoutApi, type CartPreview } from '@/lib/api/checkout';
import type { OrderType } from '@/lib/api/orders';
import { useMutation } from '@tanstack/react-query';

interface CouponBoxProps {
  /** The code currently applied (what the preview request carries); '' when none. */
  code: string;
  orderType: OrderType;
  branchId?: number | null;
  /** Latest server preview; the discount and any rejection come from here, never from local maths. */
  preview?: CartPreview | undefined;
  onApply: (code: string) => void;
  onRemove: () => void;
}

/** Promo code entry. "Apply" asks the server to validate; the resulting discount is read from the preview. */
export function CouponBox({
  code,
  orderType,
  branchId,
  preview,
  onApply,
  onRemove,
}: CouponBoxProps) {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const validate = useMutation({
    mutationFn: (value: string) => checkoutApi.validateCoupon(value, orderType, branchId),
  });

  const submit = async () => {
    const value = draft.trim().toUpperCase();
    if (!value) {
      setError('Enter a promo code.');
      return;
    }
    setError(null);
    try {
      const result = await validate.mutateAsync(value);
      setDraft('');
      onApply(result.code || value);
      toast.success(`Promo code ${result.code || value} applied.`);
    } catch (e) {
      setError(
        isApiError(e) && e.status < 500 && e.status !== 0
          ? (e.fields.code?.[0] ?? e.message)
          : describeError(e).message,
      );
    }
  };

  if (code) {
    const rejected = preview?.coupon_error ?? null;
    const applied = preview?.coupon ?? null;
    return (
      <div className="grid gap-2" data-testid="coupon-applied">
        <div className="flex items-center justify-between gap-3 rounded-md border border-border-strong bg-surface-raised px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {rejected ? (
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-danger" />
            ) : (
              <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
            )}
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {code}
                <span className="sr-only">{rejected ? ' (not applied)' : ' (applied)'}</span>
              </p>
              {applied && !rejected ? (
                <p className="text-text-muted">
                  Saves <Money value={applied.discount} />
                </p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onRemove();
              setError(null);
            }}
            leadingIcon={<X aria-hidden="true" className="size-4" />}
            aria-label={`Remove promo code ${code}`}
          >
            Remove
          </Button>
        </div>
        {rejected ? (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {rejected.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-label="Promo code"
    >
      <label htmlFor={inputId} className="text-sm font-medium">
        Promo code
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          leading={<TicketPercent aria-hidden="true" />}
          placeholder="Enter code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          maxLength={40}
        />
        <Button type="submit" variant="secondary" loading={validate.isPending}>
          Apply
        </Button>
      </div>
      {error ? (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-sm font-medium text-danger"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </form>
  );
}
