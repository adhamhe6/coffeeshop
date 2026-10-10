import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Bell, Heart, LayoutDashboard, LogIn, LogOut, MapPin, Package, User } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useFavorites } from '@/hooks/useFavorites';
import { loginUrl } from '@/lib/nav';
import { cn } from '@/lib/cn';
import { Button, Logo, Sheet, SheetContent, toast } from '@/design';
import { isNavActive, PRIMARY_NAV } from '../nav';

interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const rowClass =
  'flex min-h-12 items-center gap-3 rounded-md px-3 text-[0.9375rem] font-medium text-text hover:bg-surface-sunken [&_svg]:size-[1.125rem] [&_svg]:text-text-muted';

/** Slide-in navigation for < lg screens. Closes itself on route change. */
export function MobileNav({ open, onOpenChange }: MobileNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, staff, isAuthenticated, logout } = useAuth();
  const { count } = useFavorites();
  const close = () => onOpenChange(false);

  // Route changes (including browser back) close the drawer.
  useEffect(() => {
    onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const signOut = async () => {
    try {
      close();
      await navigate('/');
      await logout();
      toast.success('You have been signed out.');
    } catch {
      toast.error('We could not sign you out. Please try again.');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        title={<Logo title="Lantern Coffee Roasters" className="h-8 w-auto" />}
        description="Site navigation"
      >
        <nav aria-label="Mobile primary" className="px-3 pt-4">
          <ul className="grid gap-0.5">
            {PRIMARY_NAV.map((item) => {
              const active = isNavActive(item, location.pathname, location.search);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-12 items-center rounded-md px-3 font-display text-2xl font-medium hover:bg-surface-sunken',
                      active && 'text-accent-text',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mx-5 my-4 h-px bg-border" />
        <ul className="grid gap-0.5 px-3 pb-4">
          <li>
            <Link to="/favorites" onClick={close} className={rowClass}>
              <Heart aria-hidden="true" /> Favorites
              {count ? <span className="text-text-muted">({count})</span> : null}
            </Link>
          </li>
          {isAuthenticated && user ? (
            <>
              <li>
                <Link to="/account" onClick={close} className={rowClass}>
                  <User aria-hidden="true" /> Profile
                </Link>
              </li>
              <li>
                <Link to="/account/orders" onClick={close} className={rowClass}>
                  <Package aria-hidden="true" /> Orders
                </Link>
              </li>
              <li>
                <Link to="/account/addresses" onClick={close} className={rowClass}>
                  <MapPin aria-hidden="true" /> Addresses
                </Link>
              </li>
              <li>
                <Link to="/account/notifications" onClick={close} className={rowClass}>
                  <Bell aria-hidden="true" /> Notifications
                </Link>
              </li>
              {staff ? (
                <li>
                  <Link to="/admin" onClick={close} className={rowClass}>
                    <LayoutDashboard aria-hidden="true" /> Admin dashboard
                  </Link>
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className={cn(rowClass, 'w-full text-left')}
                >
                  <LogOut aria-hidden="true" /> Sign out
                </button>
              </li>
            </>
          ) : null}
        </ul>
        {!isAuthenticated ? (
          <div className="mt-auto grid gap-2.5 border-t border-border p-5">
            <Button asChild block onClick={close}>
              <Link to={loginUrl(location.pathname + location.search)}>
                <LogIn aria-hidden="true" className="size-4" /> Sign in
              </Link>
            </Button>
            <Button asChild variant="secondary" block onClick={close}>
              <Link to="/register">Create account</Link>
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
