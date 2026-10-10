import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { Button, Container, EmptyState } from '@/design';
import { useSeo } from '@/hooks/useSeo';

export default function NotFoundPage() {
  useSeo({ title: 'Page not found', noindex: true });
  return (
    <Container className="py-20 sm:py-28">
      <EmptyState
        as="h1"
        icon={<Compass aria-hidden="true" />}
        title="We could not find that page"
        description="The link may be out of date, or the page may have moved. Try the menu or head back home."
        action={
          <>
            <Button asChild>
              <Link to="/menu">Browse the menu</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/">Go home</Link>
            </Button>
          </>
        }
      />
    </Container>
  );
}
