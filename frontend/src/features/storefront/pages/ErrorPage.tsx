import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { Button, Container, ErrorState } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import NotFoundPage from './NotFoundPage';

/**
 * Route `errorElement`: unexpected render/loader errors (including failed lazy chunk loads after a deploy).
 * 404 route errors show the not-found page instead.
 */
export default function ErrorPage() {
  const error = useRouteError();
  useSeo({ title: 'Something went wrong', noindex: true });
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  const chunkFailure =
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed|Loading chunk/i.test(
      error.message,
    );
  if (import.meta.env.DEV) console.error(error);
  return (
    <Container className="py-20">
      <ErrorState
        title={chunkFailure ? 'A new version is available' : 'Something went wrong'}
        message={
          chunkFailure
            ? 'We updated the site while you were browsing. Reload to get the latest version.'
            : 'An unexpected error stopped this page from loading. Reloading usually fixes it.'
        }
        onRetry={() => window.location.reload()}
        action={
          <Button asChild variant="ghost">
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </Container>
  );
}
