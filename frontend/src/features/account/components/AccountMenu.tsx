import { Link, useLocation, useNavigate } from 'react-router';
import {
  Bell,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Package,
  User,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useUnreadNotifications } from '@/lib/api/notifications';
import { isProtectedPath, loginUrl } from '@/lib/nav';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  toast,
} from '@/design';

function initials(first: string, last: string, email: string) {
  const letters = `${first.charAt(0)}${last.charAt(0)}`.trim();
  return (letters || email.charAt(0)).toUpperCase();
}

export function AccountMenu() {
  const { user, staff, isAuthenticated, isLoading, logout } = useAuth();
  const unread = useUnreadNotifications(isAuthenticated);
  const navigate = useNavigate();
  const location = useLocation();

  if (isLoading) return <Skeleton className="mx-1.5 size-9 rounded-full" />;

  const nextParam = location.pathname + location.search;

  if (!isAuthenticated || !user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Account menu">
            <User aria-hidden="true" className="size-[1.375rem]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link to={loginUrl(nextParam)}>
              <LogIn aria-hidden="true" /> Sign in
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/register">
              <UserPlus aria-hidden="true" /> Create account
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const unreadCount = unread.data ?? 0;
  const onSignOut = async () => {
    try {
      // Leave a protected page first, or the route guard would send the signed-out visitor to /login.
      if (isProtectedPath(location.pathname)) await navigate('/', { replace: true });
      await logout();
      toast.success('You have been signed out.');
    } catch {
      toast.error('We could not sign you out. Please try again.');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.first_name || user.email}${unreadCount ? `, ${unreadCount} unread notifications` : ''}`}
          className="relative flex size-11 items-center justify-center rounded-md hover:bg-surface-sunken"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-espresso text-xs font-semibold text-cream">
            {initials(user.first_name, user.last_name, user.email)}
          </span>
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 size-2.5 rounded-full border-2 border-surface bg-accent"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-text">
            {[user.first_name, user.last_name].filter(Boolean).join(' ') || 'Your account'}
          </span>
          <span className="block truncate font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <User aria-hidden="true" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/orders">
            <Package aria-hidden="true" /> Orders
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/addresses">
            <MapPin aria-hidden="true" /> Addresses
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/notifications">
            <Bell aria-hidden="true" /> Notifications
            {unreadCount > 0 ? (
              <span className="ml-auto text-xs font-semibold text-accent-text">
                {unreadCount} new
              </span>
            ) : null}
          </Link>
        </DropdownMenuItem>
        {staff ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/admin">
                <LayoutDashboard aria-hidden="true" /> Admin dashboard
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void onSignOut()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
