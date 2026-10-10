import { useEffect, useRef, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { onUnauthorized } from '@/lib/api/client';
import { clearSession } from '@/lib/api/auth';
import { isProtectedPath, loginUrl } from '@/lib/nav';

/**
 * Global 401 handling: any API call answering 401 means the session is gone. Clear the cached identity and,
 * if the visitor is on a protected page, send them to /login?next=<page>.
 */
function UnauthorizedHandler() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(
    () =>
      onUnauthorized(() => {
        clearSession(qc);
        const here = locationRef.current;
        if (isProtectedPath(here.pathname))
          navigate(loginUrl(here.pathname + here.search), { replace: true });
      }),
    [qc, navigate],
  );
  return null;
}

/**
 * Accessibility on client-side navigation: move focus to <main> and announce the new page title to screen
 * readers. Search-param-only changes (filters, pagination) keep focus where it is.
 */
function RouteFocusManager() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    // Compare with the previous path (not "first run") so StrictMode's double effect cannot steal focus on load.
    if (previous.current === pathname) return;
    previous.current = pathname;
    const main = document.getElementById('main');
    main?.focus({ preventScroll: true });
    // Titles are applied by useSeo in the page's own effect; read after it has run.
    const id = window.setTimeout(() => setAnnouncement(document.title), 100);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}

export default function RootLayout() {
  return (
    <>
      <UnauthorizedHandler />
      <RouteFocusManager />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
