import { Archive, Ban, CircleCheckBig, TriangleAlert } from 'lucide-react';
import { Badge } from '@/design';

interface ProductStatusProps {
  isActive: boolean;
  isSoldOut: boolean;
  lowStock?: boolean;
  stockTotal?: number | null;
}

/** Active / Archived plus Sold out and Low stock. Icon + text on every chip (never colour alone). */
export function ProductStatus({ isActive, isSoldOut, lowStock, stockTotal }: ProductStatusProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {isActive ? (
        <Badge tone="success" size="sm">
          <CircleCheckBig aria-hidden="true" /> Active
        </Badge>
      ) : (
        <Badge tone="neutral" size="sm">
          <Archive aria-hidden="true" /> Archived
        </Badge>
      )}
      {isSoldOut ? (
        <Badge tone="danger" size="sm">
          <Ban aria-hidden="true" /> Sold out
        </Badge>
      ) : null}
      {lowStock ? (
        <Badge tone="warning" size="sm">
          <TriangleAlert aria-hidden="true" />
          {stockTotal === 0 ? 'Out of stock' : 'Low stock'}
        </Badge>
      ) : null}
    </div>
  );
}
