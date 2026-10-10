import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/design';
import { adminCatalogApi, type AdminReview, type ReviewStatus } from '@/lib/api/adminCatalog';
import type { Paginated } from '@/lib/api/types';
import { aqk } from '@/lib/api/adminKeys';
import { qk } from '@/lib/api/keys';
import { errorText } from '../catalog-kit/errors';

interface Vars {
  review: AdminReview;
  to: Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>;
}

/**
 * Approve / reject with an optimistic update: the review changes status in every cached list at once (and leaves
 * lists filtered by its old status). A failure restores the snapshot and explains why.
 */
export function useModerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ review, to }: Vars) =>
      to === 'APPROVED'
        ? adminCatalogApi.approveReview(review.id)
        : adminCatalogApi.rejectReview(review.id),
    onMutate: async ({ review, to }) => {
      await qc.cancelQueries({ queryKey: aqk.reviews.all });
      const snapshot = qc.getQueriesData<Paginated<AdminReview>>({ queryKey: aqk.reviews.all });
      for (const [key, data] of snapshot) {
        if (!data?.results) continue;
        const filter = (key[3] as { status?: string } | undefined)?.status;
        const results = data.results
          .map((r) => (r.id === review.id ? { ...r, status: to } : r))
          .filter((r) => !filter || r.status === filter);
        qc.setQueryData(key, {
          ...data,
          results,
          count: data.count - (data.results.length - results.length),
        });
      }
      return { snapshot };
    },
    onError: (e, { review }, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(`Could not update the review by ${review.customer.name}. ${errorText(e)}`);
    },
    onSuccess: (_d, { review, to }) =>
      toast.success(
        `Review of ${review.product.name} ${to === 'APPROVED' ? 'approved and now public' : 'rejected and hidden'}.`,
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: aqk.reviews.all });
      // Approved reviews feed product ratings on the storefront.
      void qc.invalidateQueries({ queryKey: qk.products.all });
    },
  });
}
