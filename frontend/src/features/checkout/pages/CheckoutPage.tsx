import { Link } from 'react-router';
import { PauseCircle, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, Container, EmptyState, ErrorState, Money, Skeleton, Spinner } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useCart } from '@/lib/api/cart';
import { useStore } from '@/lib/api/store';
import CheckoutFlow from '../CheckoutFlow';
import { InlineAuth } from '../components/InlineAuth';

function CartGlance() {
  const cart = useCart();
  const items = cart.data?.items ?? [];
  return (
    <aside
      aria-label="Your cart"
      className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6"
    >
      <h2 className="font-display text-h4 font-semibold">Your cart</h2>
      <ul className="mt-4 grid gap-2.5 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span>
              {item.quantity} × {item.product.name}
            </span>
            <Money value={item.line_total} />
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
        <span className="font-medium">Subtotal</span>
        <Money value={cart.data?.subtotal} className="font-display text-lg font-semibold" />
      </div>
      <p className="mt-2 text-sm text-text-muted">
        Fees, tax and your total are shown before you place the order.
      </p>
      <Button asChild variant="ghost" size="sm" className="mt-3">
        <Link to="/cart">Edit cart</Link>
      </Button>
    </aside>
  );
}

export default function CheckoutPage() {
  useSeo({ title: 'Checkout', noindex: true });
  const { isAuthenticated, isLoading } = useAuth();
  const cart = useCart();
  const store = useStore();
  const empty = (cart.data?.items.length ?? 0) === 0;

  return (
    <Container className="py-8 md:py-12">
      <h1 className="mb-8 text-h2">Checkout</h1>
      {isLoading || cart.isPending ? (
        <div className="grid gap-4" aria-busy="true">
          <Spinner className="size-6 text-text-muted" label="Loading checkout" />
          <Skeleton className="h-40" />
        </div>
      ) : cart.isError ? (
        <ErrorState
          error={cart.error}
          onRetry={() => void cart.refetch()}
          retrying={cart.isFetching}
        />
      ) : empty ? (
        <EmptyState
          icon={<ShoppingBag aria-hidden="true" />}
          title="Your cart is empty"
          description="Add something from the menu before checking out."
          action={
            <Button asChild>
              <Link to="/menu">Browse the menu</Link>
            </Button>
          }
        />
      ) : store.data?.ordering_enabled === false ? (
        <EmptyState
          icon={<PauseCircle aria-hidden="true" />}
          title="Online ordering is paused"
          description="We are not taking online orders right now. Your cart is saved. Please check back soon."
          action={
            <Button asChild variant="secondary">
              <Link to="/cart">Back to cart</Link>
            </Button>
          }
        />
      ) : !isAuthenticated ? (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12">
          <InlineAuth />
          <CartGlance />
        </div>
      ) : (
        <CheckoutFlow />
      )}
    </Container>
  );
}
