import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/lib/api/cart';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { Button, EmptyState, ErrorState, Money, Sheet, SheetContent, Skeleton } from '@/design';
import { CartLineItem } from './CartLineItem';

interface CartSheetContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Desktop: slide the cart panel in. Mobile: go to /cart. Call after "Add to cart". */
  openCart: () => void;
}

const CartSheetContext = createContext<CartSheetContextValue | null>(null);

export function CartSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const openCart = useCallback(() => {
    if (isDesktop) setOpen(true);
    else navigate('/cart');
  }, [isDesktop, navigate]);
  const value = useMemo(() => ({ open, setOpen, openCart }), [open, openCart]);
  return (
    <CartSheetContext.Provider value={value}>
      {children}
      <CartSheet />
    </CartSheetContext.Provider>
  );
}

export function useCartSheet(): CartSheetContextValue {
  const ctx = useContext(CartSheetContext);
  if (!ctx) throw new Error('useCartSheet must be used inside <CartSheetProvider>');
  return ctx;
}

function CartSheet() {
  const { open, setOpen } = useCartSheet();
  const cart = useCart();
  const close = () => setOpen(false);
  const items = cart.data?.items ?? [];
  const blocked = items.some(
    (i) => i.product.is_available === false || i.issues.some((x) => x.severity === 'error'),
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        title="Your cart"
        description="Review the drinks and goods you have added."
      >
        {cart.isPending ? (
          <div className="grid gap-4 p-5" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-3.5">
                <Skeleton className="size-20" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
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
            description="Add a drink, a bag of beans or something to eat and it will show up here."
            action={
              <Button asChild onClick={close}>
                <Link to="/menu">Browse the menu</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border px-5" aria-label="Cart items">
              {items.map((item) => (
                <CartLineItem key={item.id} item={item} variant="sheet" onNavigate={close} />
              ))}
            </ul>
            <div className="sticky bottom-0 mt-auto border-t border-border bg-surface-raised p-5">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Subtotal</span>
                <Money value={cart.data?.subtotal} className="font-display text-xl font-semibold" />
              </div>
              <p className="mt-1 text-sm text-text-muted">
                Tax, delivery and discounts are confirmed at checkout.
              </p>
              <div className="mt-4 grid gap-2.5">
                {blocked ? (
                  <>
                    <Button size="lg" block disabled aria-describedby="sheet-blocked-note">
                      Checkout
                    </Button>
                    <p id="sheet-blocked-note" className="text-sm font-medium text-danger">
                      Remove or fix the unavailable items first.
                    </p>
                  </>
                ) : (
                  <Button asChild size="lg" block onClick={close}>
                    <Link to="/checkout">Checkout</Link>
                  </Button>
                )}
                <Button asChild variant="secondary" block onClick={close}>
                  <Link to="/cart">View full cart</Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
