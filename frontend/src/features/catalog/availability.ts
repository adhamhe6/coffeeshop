import type { ProductSummary } from '@/lib/api/types';

/** Human text for `unavailable_reason` ("Unavailable at Riverside"). Returns null when the product can be ordered. */
export function unavailableText(
  product: Pick<ProductSummary, 'is_available' | 'unavailable_reason'>,
  branchName?: string | null,
): string | null {
  if (product.is_available !== false) return null;
  const where = branchName ? ` at ${branchName}` : '';
  switch (product.unavailable_reason) {
    case 'branch_unavailable':
      return `Unavailable${where || ' at this branch'}`;
    case 'out_of_stock':
      return `Out of stock${where}`;
    case 'inactive':
      return 'No longer available';
    case 'sold_out':
    default:
      return 'Sold out';
  }
}

/** Short badge label for cards. */
export function unavailableBadge(
  product: Pick<ProductSummary, 'is_available' | 'unavailable_reason'>,
  branchName?: string | null,
): string | null {
  if (product.is_available !== false) return null;
  if (product.unavailable_reason === 'branch_unavailable')
    return branchName ? `Unavailable at ${branchName}` : 'Unavailable here';
  if (product.unavailable_reason === 'out_of_stock')
    return branchName ? `Out of stock at ${branchName}` : 'Out of stock';
  return 'Sold out';
}
