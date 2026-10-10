import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, CircleCheckBig, Clock, Search, X } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Rating,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/design';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSeo } from '@/hooks/useSeo';
import { useAdminReviews, type AdminReview } from '@/lib/api/adminCatalog';
import { PageHeader } from '../../catalog-kit/PageHeader';
import { useUrlState } from '../../catalog-kit/useUrlState';
import { useModerateReview } from '../useModerateReview';

const PAGE_SIZE = 15;
const ANY = 'any';

function StatusBadge({ status }: { status: AdminReview['status'] }) {
  if (status === 'PENDING')
    return (
      <Badge tone="warning">
        <Clock aria-hidden="true" /> Pending
      </Badge>
    );
  if (status === 'APPROVED')
    return (
      <Badge tone="success">
        <CircleCheckBig aria-hidden="true" /> Approved
      </Badge>
    );
  return (
    <Badge tone="danger">
      <X aria-hidden="true" /> Rejected
    </Badge>
  );
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

export default function AdminReviewsPage() {
  useSeo({ title: 'Reviews · Admin', noindex: true });
  const { hasCapability } = useAuth();
  const canModerate = hasCapability('reviews.moderate');
  const { get, set, page } = useUrlState();
  const moderate = useModerateReview();

  const status = get('status') || 'PENDING';
  const [search, setSearch] = useState(get('q'));
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== get('q')) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const demo = get('demo') || ANY;
  const reviews = useAdminReviews({
    page,
    page_size: PAGE_SIZE,
    status: status === ANY ? undefined : status,
    rating: get('rating') || undefined,
    is_demo: demo === 'demo' ? true : demo === 'real' ? false : undefined,
    q: get('q') || undefined,
  });
  const pending = useAdminReviews({ page_size: 1, status: 'PENDING' });

  const rows = reviews.data?.results;
  const count = reviews.data?.count ?? 0;

  return (
    <div>
      <PageHeader
        title="Reviews"
        description="Approve reviews before they appear on product pages. Rejected reviews stay hidden."
      />
      <Tabs value={status} onValueChange={(v) => set({ status: v === 'PENDING' ? null : v })}>
        <TabsList aria-label="Review status">
          <TabsTrigger value="PENDING">
            Pending
            {pending.data ? (
              <Badge tone={pending.data.count ? 'warning' : 'neutral'} size="sm">
                {pending.data.count}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
          <TabsTrigger value={ANY}>All</TabsTrigger>
        </TabsList>
      </Tabs>

      <section
        aria-label="Filters"
        className="my-4 grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_10rem_12rem]"
      >
        <div>
          <label htmlFor="review-search" className="sr-only">
            Search reviews
          </label>
          <Input
            id="review-search"
            type="search"
            size="sm"
            placeholder="Search text or customer email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leading={<Search aria-hidden="true" />}
          />
        </div>
        <Select
          size="sm"
          aria-label="Rating"
          value={get('rating') || ANY}
          onValueChange={(v) => set({ rating: v === ANY ? null : v })}
          options={[
            { value: ANY, label: 'Any rating' },
            ...[5, 4, 3, 2, 1].map((n) => ({
              value: String(n),
              label: `${n} star${n === 1 ? '' : 's'}`,
            })),
          ]}
        />
        <Select
          size="sm"
          aria-label="Review source"
          value={demo}
          onValueChange={(v) => set({ demo: v === ANY ? null : v })}
          options={[
            { value: ANY, label: 'Demo and customer' },
            { value: 'demo', label: 'Demo reviews only' },
            { value: 'real', label: 'Customer reviews only' },
          ]}
        />
      </section>

      {reviews.isError && !reviews.data ? (
        <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
      ) : !rows ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={status === 'PENDING' ? 'Nothing waiting for moderation' : 'No reviews match'}
          description={
            status === 'PENDING'
              ? 'New customer reviews will appear here for approval.'
              : 'Try different filters.'
          }
        />
      ) : (
        <>
          <ul className="grid gap-3" aria-label="Reviews">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-border bg-surface-raised p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <Link
                        className="hover:underline"
                        to={`/admin/products?q=${encodeURIComponent(r.product.name)}`}
                      >
                        {r.product.name}
                      </Link>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Rating value={r.rating} />
                      <StatusBadge status={r.status} />
                      {r.is_demo ? (
                        <Badge
                          tone="outline"
                          title="Seeded demonstration content, not real customer feedback"
                        >
                          Demo review
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {canModerate ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={r.status === 'APPROVED'}
                        aria-label={`Approve review by ${r.customer.name}`}
                        leadingIcon={<Check aria-hidden="true" className="size-4" />}
                        onClick={() => moderate.mutate({ review: r, to: 'APPROVED' })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={r.status === 'REJECTED'}
                        aria-label={`Reject review by ${r.customer.name}`}
                        leadingIcon={<X aria-hidden="true" className="size-4" />}
                        onClick={() => moderate.mutate({ review: r, to: 'REJECTED' })}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
                {r.title ? <p className="mt-3 font-medium">{r.title}</p> : null}
                {r.body ? (
                  <p className="mt-1 max-w-3xl text-[0.9375rem] whitespace-pre-line">{r.body}</p>
                ) : null}
                <p className="mt-3 text-xs text-text-muted">
                  {r.customer.name} ({r.customer.email}) · {when(r.created_at)}
                  {r.order_number ? ` · order ${r.order_number}` : ''}
                  {r.moderated_by ? ` · moderated by ${r.moderated_by}` : ''}
                </p>
              </li>
            ))}
          </ul>
          <Pagination
            className="mt-4"
            page={page}
            pageCount={Math.ceil(count / PAGE_SIZE)}
            onPageChange={(p) => set({ page: p })}
          />
        </>
      )}
    </div>
  );
}
