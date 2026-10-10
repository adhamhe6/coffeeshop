import { Link } from 'react-router';
import { ShoppingBag } from 'lucide-react';
import { useCartCount } from '@/lib/api/cart';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { Button } from '@/design';
import { useCartSheet } from './CartSheet';

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-1 text-[0.6875rem] leading-none font-semibold text-accent-foreground tabular-nums"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Header cart: opens the cart panel on desktop, links to /cart on small screens. */
export function CartButton() {
  const count = useCartCount();
  const isDesktop = useIsDesktop();
  const { setOpen } = useCartSheet();
  const label = count > 0 ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart, empty';
  const icon = <ShoppingBag aria-hidden="true" className="size-[1.375rem]" />;

  return (
    <div className="relative" data-testid="cart-button">
      {isDesktop ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {icon}
        </Button>
      ) : (
        <Button asChild variant="ghost" size="icon">
          <Link to="/cart" aria-label={label}>
            {icon}
          </Link>
        </Button>
      )}
      <CountBadge count={count} />
    </div>
  );
}
