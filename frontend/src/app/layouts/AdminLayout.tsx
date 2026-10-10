import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LogOut, Menu } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { AdminBreadcrumbs } from '@/features/admin/components/AdminBreadcrumbs';
import { AdminNav } from '@/features/admin/components/AdminNav';
import { BranchScopeBadge } from '@/features/admin/components/BranchScopeBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  IconButton,
  Logo,
  LogoGlyph,
  Sheet,
  SheetContent,
  toast,
} from '@/design';

/** Keeps a crashing admin page inside the shell (navigation still works) and resets when the route changes. */
class PageBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null; key: string }
> {
  override state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; key: string },
  ) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Admin page error', error, info.componentStack);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorState
        title="This page hit a problem"
        message="The rest of the dashboard still works. Reloading usually fixes it."
        onRetry={() => window.location.reload()}
        action={
          <Link
            to="/admin"
            className="text-sm font-medium text-accent-text underline-offset-4 hover:underline"
          >
            Go to overview
          </Link>
        }
      />
    );
  }
}

/**
 * Admin shell (compact, neutral theme via `data-theme="admin"`): full sidebar on desktop, icon rail on tablet, drawer on
 * phones; topbar with breadcrumbs, branch scope, storefront link and account menu. Pages render in <Outlet/>.
 */
export default function AdminLayout() {
  const { user, staff, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);

  const signOut = async () => {
    try {
      await logout();
      qc.removeQueries({ queryKey: ['admin'] });
      navigate('/login', { replace: true });
    } catch {
      toast.error('We could not sign you out. Please try again.');
    }
  };

  return (
    <div
      data-theme="admin"
      className="min-h-dvh bg-surface text-text md:grid md:grid-cols-[4rem_1fr] lg:grid-cols-[15rem_1fr] print:block print:bg-white"
    >
      <a
        href="#main"
        className="sr-only z-[100] rounded-md bg-espresso px-4 py-2.5 text-sm font-medium text-cream focus:not-sr-only focus:fixed focus:top-3 focus:left-3 print:hidden"
      >
        Skip to main content
      </a>
      <aside className="sticky top-0 hidden h-dvh overflow-x-hidden overflow-y-auto border-r border-border bg-surface-raised md:block print:hidden">
        <div className="flex h-14 items-center border-b border-border px-5 max-lg:justify-center max-lg:px-0">
          <Link to="/admin" aria-label="Lantern admin, overview" className="rounded-md text-text">
            <Logo title="" className="h-7 w-auto max-lg:hidden" />
            <LogoGlyph className="hidden h-8 w-auto max-lg:block" />
          </Link>
        </div>
        <AdminNav responsiveRail />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface-raised/95 px-4 backdrop-blur lg:px-6 print:hidden">
          <div className="md:hidden">
            <IconButton
              label="Open admin menu"
              size="icon-sm"
              icon={<Menu aria-hidden="true" className="size-5" />}
              onClick={() => setDrawer(true)}
            />
          </div>
          <Link to="/admin" aria-label="Lantern admin" className="rounded-md text-text md:hidden">
            <Logo title="" className="h-6 w-auto" />
          </Link>
          <div className="hidden min-w-0 flex-1 md:block">
            <AdminBreadcrumbs />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div className="hidden sm:block">
              <BranchScopeBadge />
            </div>
            <Link
              to="/"
              className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-text-muted hover:bg-surface-sunken hover:text-text sm:inline-flex"
            >
              View storefront <ExternalLink aria-hidden="true" className="size-3.5" />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Account menu for ${user?.first_name ?? 'staff'}`}
                  className="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-surface-sunken"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-espresso text-xs font-semibold text-cream">
                    {(user?.first_name?.charAt(0) ?? 'S').toUpperCase()}
                  </span>
                  <span className="hidden text-sm font-medium sm:block">{user?.first_name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>
                  <span className="block text-sm font-semibold text-text">{user?.email}</span>
                  <span className="block font-normal">{staff?.role_label ?? staff?.role}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/account">
                    <ExternalLink aria-hidden="true" /> My customer account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut aria-hidden="true" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none lg:p-6 print:p-0">
          <PageBoundary resetKey={pathname}>
            <Outlet />
          </PageBoundary>
        </main>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent
          side="left"
          title="Admin menu"
          description="Admin navigation"
          data-theme="admin"
        >
          <AdminNav onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
