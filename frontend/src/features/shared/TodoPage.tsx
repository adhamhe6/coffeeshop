import { Container, EmptyState } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { Hammer } from 'lucide-react';

interface TodoPageProps {
  title: string;
  route: string;
  /** Short note for whoever implements it. */
  note?: string;
}

/**
 * Placeholder for routes that exist in the router but whose page has not been built yet.
 * Replace the route's page file (src/features/<area>/pages/…) with the real implementation.
 */
export default function TodoPage({ title, route, note }: TodoPageProps) {
  useSeo({ title, noindex: true });
  return (
    <Container className="py-16">
      <div
        data-todo-page={route}
        className="rounded-lg border border-dashed border-border-strong bg-surface-raised"
      >
        <EmptyState
          as="h1"
          icon={<Hammer aria-hidden="true" />}
          title={`${title} — not built yet`}
          description={
            <>
              <span className="font-mono text-sm">{route}</span> is routed, but its page is a
              placeholder. {note ?? 'A later wave replaces this file.'}
            </>
          }
        />
      </div>
    </Container>
  );
}
