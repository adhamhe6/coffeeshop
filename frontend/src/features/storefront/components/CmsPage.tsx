import { useContentPage } from '@/lib/api/content';
import { isApiError } from '@/lib/api/errors';
import { useSeo } from '@/hooks/useSeo';
import { Container, ErrorState, Prose, SectionHeading, Skeleton, SkeletonText } from '@/design';
import NotFoundPage from '../pages/NotFoundPage';

/** Editable long-form page (about, FAQ, privacy, terms, refund policy) rendered from `content/pages/{slug}/`. */
export function CmsPage({ slug, fallbackTitle }: { slug: string; fallbackTitle: string }) {
  const page = useContentPage(slug);
  useSeo({
    title: page.data?.title ?? fallbackTitle,
    description: page.data?.summary || undefined,
    noindex: page.isError,
  });

  if (page.isError && isApiError(page.error) && page.error.status === 404) return <NotFoundPage />;
  return (
    <Container size="narrow" className="py-14 sm:py-20" aria-busy={page.isPending || undefined}>
      {page.isPending ? (
        <div className="grid gap-6">
          <Skeleton className="h-12 w-2/3" />
          <SkeletonText lines={8} />
        </div>
      ) : page.isError ? (
        <ErrorState
          error={page.error}
          onRetry={() => void page.refetch()}
          retrying={page.isFetching}
        />
      ) : (
        <>
          <SectionHeading
            as="h1"
            title={page.data.title}
            description={page.data.summary || undefined}
          />
          <div className="mt-10">
            <Prose>{page.data.body_markdown}</Prose>
          </div>
        </>
      )}
    </Container>
  );
}
