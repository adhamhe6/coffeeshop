import { useState } from 'react';
import { Link } from 'react-router';
import { Ban, Banknote, CircleDollarSign, Printer, Undo2 } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, toast } from '@/design';
import { useTransitionOrder, type AdminOrderDetail } from '@/lib/api/adminOrders';
import { isApiError } from '@/lib/api/errors';
import { CancelOrderDialog } from './CancelOrderDialog';
import { CollectCashDialog } from './CollectCashDialog';
import { TRANSITION_LABEL } from './orderMeta';

/**
 * The only way staff change an order. Buttons come from the API's `allowed_transitions` filtered by `permissions`,
 * so the UI never offers a step the state machine or the role would refuse. Each click waits for the server result
 * (no optimistic update); 409 means someone else moved the order first, so the screen reloads and says so.
 */
export function OrderActions({ order, onPrint }: { order: AdminOrderDetail; onPrint: () => void }) {
  const { hasCapability } = useAuth();
  const transition = useTransitionOrder(order.number);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const forward = order.allowed_transitions.filter((s) => s !== 'CANCELLED');
  const perms = order.permissions;
  const refundable = order.payments.find((p) => p.can_refund);

  const run = async (to: string) => {
    setPending(to);
    try {
      const updated = await transition.mutateAsync({ to });
      toast.success(`Order ${updated.number}: ${TRANSITION_LABEL[to]?.toLowerCase() ?? to} done.`);
    } catch (e) {
      if (isApiError(e) && e.status === 409) {
        toast.error(`${e.message} The order was reloaded with its current status.`);
      } else if (isApiError(e) && e.status === 403) {
        toast.error('Your role is not allowed to do that.');
      } else {
        toast.error(isApiError(e) ? e.message : 'Could not update the order. Try again.');
      }
    } finally {
      setPending(null);
    }
  };

  const nothingToDo =
    !(perms.can_transition && forward.length) &&
    !perms.can_cancel &&
    !perms.can_collect_cash &&
    !refundable;

  return (
    <div
      role="group"
      aria-label="Order actions"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-3 print:hidden"
    >
      {perms.can_transition
        ? forward.map((to, i) => (
            <Button
              key={to}
              variant={i === 0 ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => void run(to)}
              loading={pending === to}
              loadingText="Updating…"
              disabled={pending !== null && pending !== to}
            >
              {TRANSITION_LABEL[to] ?? to}
            </Button>
          ))
        : null}
      {perms.can_collect_cash ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCashOpen(true)}
          leadingIcon={<Banknote aria-hidden="true" className="size-4" />}
        >
          Mark cash collected
        </Button>
      ) : null}
      {refundable && hasCapability('payments.refund') ? (
        <Button
          asChild
          variant="secondary"
          size="sm"
          leadingIcon={<Undo2 aria-hidden="true" className="size-4" />}
        >
          <Link to={`/admin/payments?payment=${refundable.id}`}>Refund payment…</Link>
        </Button>
      ) : null}
      {nothingToDo ? (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <CircleDollarSign aria-hidden="true" className="size-4" />
          {order.allowed_transitions.length === 0
            ? 'This order is final. No further steps.'
            : 'You can view this order, but your role cannot change it.'}
        </p>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onPrint}
          leadingIcon={<Printer aria-hidden="true" className="size-4" />}
          aria-keyshortcuts="P"
        >
          Print ticket
        </Button>
        {perms.can_cancel ? (
          <Button
            variant="secondary"
            size="sm"
            className="border-danger text-danger hover:bg-danger-bg"
            onClick={() => setCancelOpen(true)}
            leadingIcon={<Ban aria-hidden="true" className="size-4" />}
          >
            Cancel order
          </Button>
        ) : null}
      </div>
      <CancelOrderDialog order={order} open={cancelOpen} onOpenChange={setCancelOpen} />
      <CollectCashDialog order={order} open={cashOpen} onOpenChange={setCashOpen} />
    </div>
  );
}
