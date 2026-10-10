import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ProductSummary } from '@/lib/api/types';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-9 md:grid-cols-3 lg:gap-x-6';

interface ResultsGridProps {
  products: ProductSummary[];
  /** Sidebar present: fewer columns at xl. */
  withSidebar?: boolean;
  className?: string;
  /** Rendered as the first grid cell(s), e.g. a feature tile. */
  lead?: ReactNode;
}

export function ResultsGrid({ products, withSidebar, className, lead }: ResultsGridProps) {
  return (
    <ul className={cn(GRID, withSidebar ? '2xl:grid-cols-4' : 'xl:grid-cols-4', className)}>
      {lead}
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard
            product={p}
            aspect="1/1"
            showAdd
            priority={i < 4}
            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
          />
        </li>
      ))}
    </ul>
  );
}

export function ResultsSkeleton({
  count = 8,
  withSidebar,
}: {
  count?: number;
  withSidebar?: boolean;
}) {
  return (
    <div
      className={cn(GRID, withSidebar ? '2xl:grid-cols-4' : 'xl:grid-cols-4')}
      aria-busy="true"
      aria-label="Loading products"
    >
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} aspect="1/1" />
      ))}
    </div>
  );
}
