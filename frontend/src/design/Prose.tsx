import { lazy, Suspense } from 'react';
import { SkeletonText } from './Skeleton';

// The markdown stack is ~40 kB gzipped; only pages that render CMS content pay for it.
const ProseRenderer = lazy(() => import('./ProseRenderer'));

interface ProseProps {
  /** Markdown source from the CMS. Raw HTML is never rendered. */
  children: string;
  className?: string;
}

export function Prose({ children, className }: ProseProps) {
  return (
    <Suspense fallback={<SkeletonText lines={6} className="max-w-[68ch]" />}>
      <ProseRenderer className={className}>{children}</ProseRenderer>
    </Suspense>
  );
}
