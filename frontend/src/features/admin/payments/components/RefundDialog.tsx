import { useRef, useState } from 'react';
import { CircleAlert, CircleCheckBig, Hourglass, Info } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Money,
  Textarea,
  toast,
  useMoney,
} from '@/design';
import { newIdempotencyKey } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import {
  useRefundPayment,
  type AdminPaymentDetail,
  type AdminRefund,
} from '@/lib/api/adminPayments';
import { cn } from '@/lib/cn';

type Phase =
  | { kind: 'form' }
  | { kind: 'done'; refund: AdminRefund }
  | { kind: 'failed'; message: string; refund?: AdminRefund };

/** Plain-language note about where this refund really goes. */
function providerCopy(p: AdminPaymentDetail): string {
  if (p.provider === 'cash')
    return 'This was a cash payment. Recording the refund does not move any money: hand the cash back to the customer yourself.';
  if (p.provider === 'demo')
    return 'This is a sandbox payment. The refund is simulated and no real money moves.';
  return `The refund is sent to ${p.provider_label}. It can take a few days to reach the customer's card, and the provider may still decline it. Cancelling an order never refunds it by itself.`;
}

const parseAmount = (raw: string): number | null => {
  const clean = raw.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Number(clean);
};

type DialogProps = {
  payment: AdminPaymentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RefundDialog(props: DialogProps) {
  // Form state and the idempotency key live in a child that only exists while open: every opening is a new attempt.
  return props.open ? <RefundDialogBody {...props} /> : null;
}

function RefundDialogBody({ payment, open, onOpenChange }: DialogProps) {
  const refund = useRefundPayment(payment.id);
  const { format } = useMoney();
  const remaining = payment.refundable_amount;
  const [amount, setAmount] = useState(remaining);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string; form?: string }>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  // One key per refund attempt: a retry after a lost response re-sends the SAME key and so can never refund twice.
  const key = useRef(newIdempotencyKey());

  const submit = async () => {
    const value = parseAmount(amount);
    const next: typeof errors = {};
    if (value === null || value <= 0) next.amount = 'Enter an amount greater than zero, like 4.50.';
    else if (value > Number(remaining) + 1e-9)
      next.amount = `The most you can refund is ${format(remaining)}.`;
    if (!reason.trim()) next.reason = 'Enter a reason. It is kept with the refund.';
    setErrors(next);
    if (next.amount || next.reason) return;

    const full = value !== null && Math.abs(value - Number(remaining)) < 1e-9;
    try {
      const res = await refund.mutateAsync({
        // Leaving the amount out asks for "everything that can still be refunded".
        amount: full ? undefined : value?.toFixed(2),
        reason: reason.trim(),
        idempotencyKey: key.current,
      });
      setPhase({ kind: 'done', refund: res.refund });
      toast.success(
        res.refund.status === 'PENDING'
          ? 'Refund submitted. Waiting for the provider.'
          : 'Refund completed.',
      );
    } catch (e) {
      if (isApiError(e) && e.code === 'refund_failed') {
        setPhase({
          kind: 'failed',
          message: e.message,
          refund: (e.extra.refund as AdminRefund | undefined) ?? undefined,
        });
        return;
      }
      if (isApiError(e) && e.fields && Object.keys(e.fields).length) {
        setErrors({
          amount: e.fields.amount?.[0],
          reason: e.fields.reason?.[0],
          form: e.fields.amount || e.fields.reason ? undefined : e.message,
        });
        return;
      }
      setErrors({
        form: isApiError(e)
          ? e.isNetwork
            ? 'We could not reach the server, so we do not know whether the refund went through. Press the button again: it is safe, the same request is never refunded twice.'
            : e.message
          : 'The refund could not be processed.',
      });
    }
  };

  const retryAfterFailure = () => {
    key.current = newIdempotencyKey(); // a definitive failure is a new attempt
    setPhase({ kind: 'form' });
  };

  const title =
    phase.kind === 'form'
      ? 'Refund payment'
      : phase.kind === 'done'
        ? phase.refund.status === 'PENDING'
          ? 'Refund submitted'
          : 'Refund completed'
        : 'Refund failed';

  return (
    <Dialog open={open} onOpenChange={(o) => !refund.isPending && onOpenChange(o)}>
      <DialogContent
        title={title}
        description={
          phase.kind === 'form'
            ? `Order ${payment.order.number} · ${payment.provider_label} · paid ${format(payment.amount)}`
            : undefined
        }
      >
        {phase.kind === 'form' ? (
          <form
            id="refund-form"
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="flex items-start gap-2 rounded-md bg-neutral-bg p-3 text-sm">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {providerCopy(payment)}
            </p>
            <Field
              label="Amount to refund"
              required
              error={errors.amount}
              hint={
                <>
                  Up to <Money value={remaining} /> can still be refunded.{' '}
                  {Number(payment.refunded_total) > 0 ? (
                    <>
                      (<Money value={payment.refunded_total} /> already refunded.){' '}
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-xs font-medium text-accent-text underline underline-offset-4"
                    onClick={() => setAmount(remaining)}
                  >
                    Use the full amount
                  </button>
                </>
              }
            >
              <Input
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                leading={<span aria-hidden="true">{payment.currency}</span>}
                className="pl-14 tabular-nums"
              />
            </Field>
            <Field label="Reason" required error={errors.reason}>
              <Textarea
                rows={2}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {errors.form ? (
              <p role="alert" className="flex items-start gap-2 text-sm text-danger">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {errors.form}
              </p>
            ) : null}
          </form>
        ) : phase.kind === 'done' ? (
          <div
            role="status"
            data-refund-status={phase.refund.status}
            className={cn(
              'flex items-start gap-3 rounded-md p-3 text-sm',
              phase.refund.status === 'PENDING' ? 'bg-warning-bg' : 'bg-success-bg',
            )}
          >
            {phase.refund.status === 'PENDING' ? (
              <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            ) : (
              <CircleCheckBig aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            )}
            <div>
              <p className="font-semibold">
                <Money value={phase.refund.amount} />{' '}
                {phase.refund.status === 'PENDING' ? 'is waiting for the provider' : 'refunded'}
              </p>
              {phase.refund.status === 'PENDING' ? (
                <p className="mt-1">
                  The provider has accepted the request but has not confirmed it yet. Nothing more
                  is needed: the refund shows as pending on this payment and updates by itself when
                  the provider confirms. Do not issue it again.
                </p>
              ) : (
                <p className="mt-1">{providerCopy(payment)}</p>
              )}
            </div>
          </div>
        ) : (
          <div
            role="alert"
            data-refund-status="FAILED"
            className="flex items-start gap-3 rounded-md bg-danger-bg p-3 text-sm"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="font-semibold text-danger">The refund did not go through</p>
              <p className="mt-1">{phase.message}</p>
              <p className="mt-1 text-text-muted">
                Nothing was returned to the customer. You can try again.
              </p>
            </div>
          </div>
        )}
        <DialogFooter className="-mx-6 mt-5 -mb-5">
          {phase.kind === 'form' ? (
            <>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={refund.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="refund-form"
                loading={refund.isPending}
                loadingText="Refunding…"
              >
                Refund {parseAmount(amount) !== null ? format(parseAmount(amount)) : ''}
              </Button>
            </>
          ) : phase.kind === 'failed' ? (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={retryAfterFailure}>Try again</Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
