import { Link } from 'react-router';
import { LogIn, MapPin, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, Container, EmptyState, ErrorState, Money, Skeleton, Spinner } from '@/design';
import { useBranches } from '@/lib/api/branches';
import { useCart } from '@/lib/api/cart';
import { usePreview } from '@/lib/api/checkout';
import { useSeo } from '@/hooks/useSeo';
import { loginUrl } from '@/lib/nav';
import { useCheckoutSelection } from '@/features/checkout/selection';
import { CartLineItem } from '../components/CartLineItem';
import { CouponBox } from '../components/CouponBox';
import { CHOICE_CODES, IssueList } from '../components/IssueList';
import { PriceBreakdown } from '../components/PriceBreakdown';

function CartSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]" aria-busy="true">
      <div className="grid gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="size-24" />
            <div className="grid flex-1 content-start gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export default function CartPage() {
  useSeo({ title: 'Your cart', noindex: true });
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const cart = useCart();
  const branches = useBranches();
  const selection = useCheckoutSelection();
  const items = cart.data?.items ?? [];
  const branch = branches.data?.find((b) => b.slug === selection.branchSlug);

  const preview = usePreview(
    {
      order_type: selection.orderType,
      branch_id: branch?.id ?? null,
      coupon_code: selection.couponCode || undefined,
    },
    items.length > 0,
  );

  // Choosing a branch/address happens at checkout, so those "blockers" are not cart problems.
  const blockers = (preview.data?.checkout_blockers ?? []).filter((b) => !CHOICE_CODES.has(b.code));
  const cartIssues = (cart.data?.issues ?? []).filter(
    (i) => !blockers.some((b) => b.code === i.code && b.message === i.message),
  );
  const hasUnavailable = items.some(
    (i) => i.product.is_available === false || i.issues.some((x) => x.severity === 'error'),
  );
  const blocked = hasUnavailable || blockers.some((b) => b.severity !== 'warning');

  return (
    <Container className="py-8 md:py-12">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h2">Your cart</h1>
        {items.length > 0 ? (
          <p className="text-text-muted" data-testid="cart-count">
            {cart.data?.item_count} {cart.data?.item_count === 1 ? 'item' : 'items'}
          </p>
        ) : null}
      </div>

      {cart.isPending ? (
        <CartSkeleton />
      ) : cart.isError ? (
        <ErrorState
          error={cart.error}
          onRetry={() => void cart.refetch()}
          retrying={cart.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag aria-hidden="true" />}
          title="Your cart is empty"
          description="Add a drink, a bag of beans or something to eat, and it will wait for you here."
          action={
            <>
              <Button asChild>
                <Link to="/menu">Browse the menu</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/locations">
                  <MapPin aria-hidden="true" className="size-4" /> Find a location
                </Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-12">
          <section aria-label="Items in your cart">
            {!authLoading && !isAuthenticated ? (
              <div
                className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised p-4"
                data-testid="guest-prompt"
              >
                <p className="text-[0.9375rem]">
                  <span className="font-medium">Sign in to check out.</span>{' '}
                  <span className="text-text-muted">Your cart is saved, so nothing is lost.</span>
                </p>
                <div className="flex gap-2">
                  <Button asChild size="sm">
                    <Link to={loginUrl('/checkout')}>
                      <LogIn aria-hidden="true" className="size-4" /> Sign in
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/register?next=%2Fcheckout">Create account</Link>
                  </Button>
                </div>
              </div>
            ) : null}
            <ul className="divide-y divide-border border-y border-border" aria-label="Cart items">
              {items.map((item) => (
                <CartLineItem key={item.id} item={item} />
              ))}
            </ul>
            <p className="mt-5 text-sm text-text-muted">
              <Link to="/menu" className="rounded-xs underline underline-offset-4">
                Continue shopping
              </Link>
            </p>
          </section>

          <aside
            aria-label="Order summary"
            className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]"
          >
            <h2 className="font-display text-h4 font-semibold">Summary</h2>
            <div className="mt-4 grid gap-5">
              <CouponBox
                code={selection.couponCode}
                orderType={selection.orderType}
                branchId={branch?.id}
                preview={preview.data}
                onApply={selection.setCouponCode}
                onRemove={() => selection.setCouponCode('')}
              />
              <IssueList issues={[...blockers, ...cartIssues]} />
              <div className="border-t border-border pt-5" aria-live="polite">
                {preview.data ? (
                  <PriceBreakdown preview={preview.data} estimate />
                ) : preview.isError ? (
                  <div className="grid gap-3">
                    <p className="text-sm text-danger">
                      We could not work out your total just now.
                    </p>
                    <div className="flex items-baseline justify-between">
                      <span className="text-text-muted">Subtotal</span>
                      <Money value={cart.data?.subtotal} className="font-medium" />
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => void preview.refetch()}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-text-muted">
                    <span>Calculating your total…</span>
                    <Spinner label={null} />
                  </div>
                )}
              </div>
              <p className="text-sm text-text-muted">
                Estimate for {selection.orderType === 'DELIVERY' ? 'delivery' : 'pickup'}. Choose
                pickup or delivery, your location and any delivery address at checkout, where the
                final total is confirmed.
              </p>
              <div className="grid gap-2">
                {blocked ? (
                  <>
                    <Button size="lg" block disabled aria-describedby="cart-blocked-note">
                      Checkout
                    </Button>
                    <p id="cart-blocked-note" className="text-sm font-medium text-danger">
                      Fix the items above to continue.
                    </p>
                  </>
                ) : (
                  <Button asChild size="lg" block>
                    <Link to="/checkout">Checkout</Link>
                  </Button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </Container>
  );
}
