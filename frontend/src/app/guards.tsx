import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { loginUrl } from '@/lib/nav';
import { Button, Container, EmptyState, Spinner } from '@/design';
import { useSeo } from '@/hooks/useSeo';

function FullPageSpinner() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center" aria-busy="true">
      <Spinner className="size-6 text-text-muted" label="Checking your session" />
    </div>
  );
}

/** Customer-only routes: anonymous visitors are sent to /login?next=<current page>. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (!isAuthenticated)
    return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  return <>{children}</>;
}

function Forbidden({ message, inAdmin = false }: { message: string; inAdmin?: boolean }) {
  useSeo({ title: 'Access denied', noindex: true });
  return (
    <Container className="py-20">
      <EmptyState
        as="h1"
        icon={<ShieldAlert aria-hidden="true" />}
        title="You do not have access to this page"
        description={message}
        action={
          inAdmin ? (
            <Button asChild variant="secondary">
              <Link to="/admin">Back to the dashboard</Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link to="/">Back to the storefront</Link>
            </Button>
          )
        }
      />
    </Container>
  );
}

/** Admin area: requires a staff profile. The backend enforces the same rules on every request. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { isAuthenticated, isStaff, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageSpinner />;
  if (!isAuthenticated)
    return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  if (!isStaff)
    return (
      <Forbidden message="This area is for Lantern staff. If you think this is a mistake, ask an administrator." />
    );
  return <>{children}</>;
}

/** Route-level capability check (the sidebar hides links, this stops direct URL access). */
export function RequireCapability({
  capability,
  children,
}: {
  capability: string;
  children: ReactNode;
}) {
  const { hasCapability } = useAuth();
  if (!hasCapability(capability))
    return <Forbidden inAdmin message="Your role does not include this section." />;
  return <>{children}</>;
}
