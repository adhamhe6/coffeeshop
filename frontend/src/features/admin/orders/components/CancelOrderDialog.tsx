import { useState } from 'react';
import { CircleAlert, CircleCheckBig, Hourglass, Info } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Textarea,
  toast,
} from '@/design';
import { isApiError } from '@/lib/api/errors';
import {
  useCancelOrder,
  type AdminCancelResponse,
  type AdminOrderDetail,
  type AdminRefundOutcome,
} from '@/lib/api/adminOrders';
import { cn } from '@/lib/cn';

const MAX_REASON = 200;

const OUTCOME: Record<
  AdminRefundOutcome['status'],
  { title: string; tone: string; icon: typeof Info }
> = {
  NOT_REQUESTED: { title: 'No refund requested', tone: 'bg-neutral-bg text-text', icon: Info },
  NOT_APPLICABLE: { title: 'Nothing to refund', tone: 'bg-neutral-bg text-text', icon: Info },
  ALREADY_REFUNDED: { title: 'Already refunded', tone: 'bg-neutral-bg text-text', icon: Info },
  SUCCEEDED: {
    title: 'Refund succeeded',
    tone: 'bg-success-bg text-success',
    icon: CircleCheckBig,
  },
  PENDING: { title: 'Refund pending', tone: 'bg-warning-bg text-warning', icon: Hourglass },
  FAILED: { title: 'Refund failed', tone: 'bg-danger-bg text-danger', icon: CircleAlert },
};

/** The real refund outcome returned by the API, in plain words. Never inferred, never optimistic. */
export function RefundOutcomeNotice({ outcome }: { outcome: AdminRefundOutcome }) {
  const meta = OUTCOME[outcome.status];
  const Icon = meta.icon;
  return (
    <div
      role={outcome.status === 'FAILED' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-md p-3 text-sm', meta.tone)}
      data-refund-status={outcome.status}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">{meta.title}</p>
        <p className="mt-0.5 text-text">{outcome.message}</p>
        {outcome.status === 'PENDING' ? (
          <p className="mt-1 text-text-muted">
            The provider has not confirmed yet. The status updates on the Payments page when it
            does.
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface Props {
  order: AdminOrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Cancel an order: a reason is required. Cancelling does NOT refund by itself; when the role may refund and a payment is
 * refundable, an explicit checkbox asks for a refund too. After the request the dialog shows what actually happened.
 */
export function CancelOrderDialog(props: Props) {
  // The form state lives in a child that only exists while the dialog is open, so every opening starts clean.
  return props.open ? <CancelOrderDialogBody {...props} /> : null;
}

function CancelOrderDialogBody({ order, open, onOpenChange }: Props) {
  const cancel = useCancelOrder(order.number);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdminCancelResponse | null>(null);
  const canRefund = order.permissions.can_refund;
  const heldAmount = order.payments.find((p) => Number(p.refundable_amount) > 0);

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Enter a reason for cancelling. It is saved in the order history.');
      return;
    }
    setError(null);
    try {
      const res = await cancel.mutateAsync({ reason: trimmed, refund: canRefund && refund });
      setResult(res);
      toast.success(`Order ${order.number} cancelled.`);
    } catch (e) {
      if (isApiError(e) && e.status === 409) {
        setError(`${e.message} The order has been reloaded.`);
      } else if (isApiError(e) && e.status === 403) {
        setError('Your role is not allowed to do that.');
      } else if (isApiError(e) && e.fields.reason?.[0]) {
        setError(e.fields.reason[0]);
      } else {
        setError(isApiError(e) ? e.message : 'The order could not be cancelled. Try again.');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !cancel.isPending && onOpenChange(o)}>
      <DialogContent
        title={result ? `Order ${order.number} cancelled` : `Cancel order ${order.number}?`}
        description={
          result
            ? undefined
            : 'The customer is notified. Stock and any coupon are released. This cannot be undone.'
        }
      >
        {result ? (
          <div className="grid gap-3">
            <p className="text-sm">The order is now cancelled.</p>
            <RefundOutcomeNotice outcome={result.refund} />
            {result.refund.status === 'NOT_REQUESTED' &&
            order.payments.some((p) => Number(p.refundable_amount) > 0) ? (
              <p className="text-sm text-text-muted">
                Cancelling does not return money by itself. Refund the payment from the order or the
                Payments page when you are ready.
              </p>
            ) : null}
          </div>
        ) : (
          <form
            id="cancel-order-form"
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field
              label="Reason for cancelling"
              required
              error={error ?? undefined}
              hint={`Shown in the order history. ${MAX_REASON - reason.length} characters left.`}
            >
              <Textarea
                rows={3}
                maxLength={MAX_REASON}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {canRefund && heldAmount ? (
              <Checkbox
                checked={refund}
                onCheckedChange={(c) => setRefund(c === true)}
                label="Also refund the payment"
                description="Refunds go through the payment provider and the result is shown here. Without this, the customer keeps being charged until you refund separately."
              />
            ) : order.payments.some((p) => Number(p.refundable_amount) > 0) ? (
              <p className="flex items-start gap-2 rounded-md bg-neutral-bg p-3 text-sm">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                This order has been paid. Cancelling does not refund it, and your role cannot issue
                refunds, so ask someone with refund access afterwards.
              </p>
            ) : null}
          </form>
        )}
        <DialogFooter className="-mx-6 mt-5 -mb-5">
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={cancel.isPending}
              >
                Keep order
              </Button>
              <Button
                type="submit"
                form="cancel-order-form"
                variant="danger"
                loading={cancel.isPending}
                loadingText="Cancelling…"
              >
                {canRefund && refund ? 'Cancel and refund' : 'Cancel order'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
