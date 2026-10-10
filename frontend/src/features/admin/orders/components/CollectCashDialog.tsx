import { Button, Dialog, DialogContent, DialogFooter, Money, toast } from '@/design';
import { useCollectCash, type AdminOrderDetail } from '@/lib/api/adminOrders';
import { isApiError } from '@/lib/api/errors';

/** Confirms that the cash for a cash order was actually received (a financial record, so it asks first). */
export function CollectCashDialog({
  order,
  open,
  onOpenChange,
}: {
  order: AdminOrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const collect = useCollectCash(order.number);
  const confirm = async () => {
    try {
      await collect.mutateAsync();
      toast.success(`Cash for ${order.number} recorded as collected.`);
      onOpenChange(false);
    } catch (e) {
      toast.error(isApiError(e) ? e.message : 'Could not record the cash payment. Try again.');
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !collect.isPending && onOpenChange(o)}>
      <DialogContent
        title="Mark cash as collected?"
        description={
          <>
            Confirm you received <Money value={order.totals.total} /> in cash for order{' '}
            {order.number}. The payment is recorded as paid.
          </>
        }
      >
        <DialogFooter className="-mx-6 -mb-5">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={collect.isPending}
          >
            Not yet
          </Button>
          <Button onClick={() => void confirm()} loading={collect.isPending} loadingText="Saving…">
            Yes, cash collected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
