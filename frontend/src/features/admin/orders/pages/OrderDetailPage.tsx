import { useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, RefreshCw, SearchX } from 'lucide-react';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge } from '@/design';
import { useAdminOrder } from '@/lib/api/adminOrders';
import { isApiError } from '@/lib/api/errors';
import { useSeo } from '@/hooks/useSeo';
import { PageHeader } from '../../ops/PageHeader';
import { OrderActions } from '../components/OrderActions';
import {
  OrderCustomer,
  OrderFacts,
  OrderHistory,
  OrderItems,
  OrderNotes,
  OrderPayments,
  OrderTotals,
  useNoteRef,
} from '../components/OrderSections';
import { OrderTicket } from '../components/OrderTicket';
import { AttentionNote, OrderTypeLabel } from '../components/orderMeta';

export default function AdminOrderDetailPage() {
  const { number = '' } = useParams();
  const { data: order, isPending, isError, error, refetch, isFetching } = useAdminOrder(number);
  useSeo({ title: `Order ${number} · Admin`, noindex: true });
  const noteRef = useNoteRef();

  const print = useCallback(() => window.print(), []);

  // Small keyboard helpers (ignored while typing or when a dialog is open): P prints, N jumps to the note box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable], [role=dialog]') !== null)
        return;
      if (document.querySelector('[role=dialog]')) return;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        print();
      } else if ((e.key === 'n' || e.key === 'N') && noteRef.current) {
        e.preventDefault();
        noteRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [print, noteRef]);

  const back = (
    <Link
      to="/admin/orders"
      className="inline-flex items-center gap-1.5 rounded-xs text-sm font-medium text-text-muted hover:text-text print:hidden"
    >
      <ArrowLeft aria-hidden="true" className="size-4" /> All orders
    </Link>
  );

  if (isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading order">
        {back}
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-14" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (isError || !order) {
    const notFound = isApiError(error) && error.status === 404;
    return (
      <div className="grid gap-4">
        {back}
        {notFound ? (
          <EmptyState
            as="h1"
            icon={<SearchX aria-hidden="true" />}
            title="Order not found"
            description={`There is no order ${number} that you can see. It may belong to a branch outside your access.`}
            action={
              <Button asChild variant="secondary">
                <Link to="/admin/orders">Back to orders</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 print:hidden">
        {back}
        <PageHeader
          title={
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="tabular-nums">Order {order.number}</span>
              <StatusBadge kind="order" status={order.status} className="align-middle font-sans" />
            </span>
          }
          meta={
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-text-muted">
              <OrderTypeLabel type={order.order_type} />
              <span>{order.branch.name}</span>
              <span>{order.customer_name}</span>
            </p>
          }
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refetch()}
              loading={isFetching}
              leadingIcon={<RefreshCw aria-hidden="true" className="size-4" />}
            >
              Refresh
            </Button>
          }
        />
        <OrderFacts order={order} />
        {order.needs_attention ? (
          <div role="status" className="rounded-md border border-warning bg-warning-bg px-3 py-2">
            <AttentionNote message={order.needs_attention.message} />
          </div>
        ) : null}
        {order.cancel_reason ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            <span className="font-semibold">Cancelled: </span>
            {order.cancel_reason}
          </p>
        ) : null}
        <OrderActions order={order} onPrint={print} />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid min-w-0 gap-4">
            <OrderItems order={order} />
            <OrderTotals order={order} />
            <OrderPayments order={order} />
          </div>
          <div className="grid min-w-0 gap-4">
            <OrderCustomer order={order} />
            <OrderNotes order={order} noteRef={noteRef} />
            <OrderHistory order={order} />
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Shortcuts: <kbd className="rounded-xs border border-border-strong px-1">P</kbd> print
          ticket, <kbd className="rounded-xs border border-border-strong px-1">N</kbd> add a note.
        </p>
      </div>
      <OrderTicket order={order} />
    </>
  );
}
