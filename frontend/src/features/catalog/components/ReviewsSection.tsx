import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BadgeCheck, FlaskConical, MessageSquarePlus } from 'lucide-react';
import { applyApiErrors } from '@/lib/forms';
import { loginUrl } from '@/lib/nav';
import { useStore } from '@/lib/api/store';
import type { ReviewSummary } from '@/lib/api/types';
import { FormAlert } from '@/features/account/components/FormAlert';
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Input,
  Rating,
  RatingInput,
  Skeleton,
  Textarea,
  toast,
} from '@/design';
import {
  useReviewEligibility,
  useReviews,
  useSubmitReview,
  type Review,
  type ReviewEligibilityReason,
} from '../api';

const schema = z.object({
  rating: z
    .number({
      required_error: 'Choose a star rating.',
      invalid_type_error: 'Choose a star rating.',
    })
    .int()
    .min(1, 'Choose a star rating.')
    .max(5),
  title: z.string().trim().max(100, 'Keep the headline under 100 characters.'),
  body: z.string().trim().max(2000, 'Keep your review under 2000 characters.'),
});
type FormValues = z.infer<typeof schema>;

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

function Distribution({ summary }: { summary: ReviewSummary }) {
  const rows = [...summary.distribution].sort((a, b) => b.rating - a.rating);
  return (
    <ul aria-label="Rating distribution" className="grid gap-2">
      {rows.map((row) => {
        const pct = summary.count ? Math.round((row.count / summary.count) * 100) : 0;
        return (
          <li key={row.rating} className="flex items-center gap-3 text-sm">
            <span className="w-14 shrink-0 tabular-nums">{row.rating} stars</span>
            <span
              aria-hidden="true"
              className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-sunken"
            >
              <span className="block h-full rounded-pill bg-accent" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right text-text-muted tabular-nums">
              {row.count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ReviewItem({ review }: { review: Review }) {
  return (
    <li className="grid gap-2 border-t border-border py-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Rating value={review.rating} />
        {review.title ? <h3 className="font-medium">{review.title}</h3> : null}
      </div>
      {review.body ? <p className="max-w-prose text-text">{review.body}</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-text-muted">
        <span>{review.author}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={review.created_at}>{dateFormat.format(new Date(review.created_at))}</time>
        {review.verified_purchase ? (
          <Badge tone="success" size="sm">
            <BadgeCheck aria-hidden="true" /> Verified purchase
          </Badge>
        ) : null}
        {review.is_demo ? (
          <Badge tone="info" size="sm">
            <FlaskConical aria-hidden="true" /> Demo review
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

const reasonText: Record<ReviewEligibilityReason, string> = {
  login_required: 'Sign in to write a review.',
  reviews_disabled: 'Reviews are turned off right now.',
  not_purchased: 'Reviews are open to customers who have received this item.',
  already_reviewed: 'You have already reviewed this product. Thank you.',
};

function ReviewForm({ slug, onDone }: { slug: string; onDone: () => void }) {
  const submit = useSubmitReview(slug);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', body: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await submit.mutateAsync(values);
      toast.success('Thanks. Your review is awaiting moderation.');
      onDone();
    } catch (error) {
      setFormError(applyApiErrors(error, setError, ['rating', 'title', 'body']));
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid gap-5 rounded-lg border border-border bg-surface-raised p-5 lg:p-6"
    >
      <h3 className="font-display text-h4 font-semibold">Write a review</h3>
      <FormAlert>{formError}</FormAlert>
      <Field label="Your rating" required error={errors.rating?.message}>
        <Controller
          control={control}
          name="rating"
          render={({ field }) => (
            <RatingInput
              value={field.value ?? null}
              onChange={field.onChange}
              label="Your rating"
            />
          )}
        />
      </Field>
      <Field label="Headline" error={errors.title?.message}>
        <Input maxLength={100} {...register('title')} />
      </Field>
      <Field
        label="Your review"
        hint="Reviews are checked by our team before they appear."
        error={errors.body?.message}
      >
        <Textarea rows={4} maxLength={2000} {...register('body')} />
      </Field>
      <Button
        type="submit"
        loading={submit.isPending}
        loadingText="Sending…"
        className="justify-self-start"
      >
        Submit review
      </Button>
    </form>
  );
}

function WriteReview({ slug }: { slug: string }) {
  const location = useLocation();
  const eligibility = useReviewEligibility(slug);
  const [submitted, setSubmitted] = useState(false);

  if (submitted)
    return (
      <div role="status" className="rounded-lg border border-border bg-success-bg p-5 text-success">
        <p className="font-medium">Thank you. Your review has been received.</p>
        <p className="mt-1 text-sm">
          It is awaiting moderation and will appear here once approved.
        </p>
      </div>
    );
  if (eligibility.isPending) return <Skeleton className="h-12 w-60" />;
  if (eligibility.isError || !eligibility.data) return null;
  const { can_review, reason } = eligibility.data;
  if (can_review) return <ReviewForm slug={slug} onDone={() => setSubmitted(true)} />;
  if (!reason) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-text-muted">
      <MessageSquarePlus aria-hidden="true" className="size-4" />
      {reasonText[reason]}
      {reason === 'login_required' ? (
        <Button asChild variant="link">
          <Link to={loginUrl(location.pathname + location.search)}>Sign in</Link>
        </Button>
      ) : null}
    </p>
  );
}

/** Rating summary, paged review list (demo reviews labelled) and the write-a-review flow (only when eligible). */
export function ReviewsSection({
  slug,
  productName,
  summary,
}: {
  slug: string;
  productName: string;
  summary: ReviewSummary | undefined;
}) {
  const store = useStore();
  const enabled = store.data?.enable_reviews !== false;
  const reviews = useReviews(slug, enabled);
  if (!enabled) return null;
  const items = reviews.data?.pages.flatMap((p) => p.results) ?? [];
  const hasDemo = items.some((r) => r.is_demo);

  return (
    <section id="reviews" aria-labelledby="reviews-title" className="scroll-mt-28">
      <h2 id="reviews-title" className="text-h2">
        Reviews
      </h2>
      <div className="mt-8 grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-16">
        <div className="grid content-start gap-5">
          {summary && summary.count > 0 && summary.average !== null ? (
            <>
              <div>
                <p className="font-display text-5xl leading-none font-medium tabular-nums">
                  {summary.average.toFixed(1)}
                </p>
                <Rating value={summary.average} count={summary.count} size="lg" className="mt-3" />
              </div>
              <Distribution summary={summary} />
            </>
          ) : (
            <p className="text-text-muted">No reviews yet for {productName}.</p>
          )}
          <WriteReview slug={slug} />
        </div>
        <div>
          {reviews.isPending ? (
            <div className="grid gap-5" aria-busy="true">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : reviews.isError ? (
            <ErrorState
              error={reviews.error}
              onRetry={() => void reviews.refetch()}
              retrying={reviews.isFetching}
              className="py-6"
            />
          ) : items.length === 0 ? null : (
            <>
              <ul aria-label={`Reviews of ${productName}`}>
                {items.map((r) => (
                  <ReviewItem key={r.id} review={r} />
                ))}
              </ul>
              {reviews.hasNextPage ? (
                <Button
                  variant="secondary"
                  onClick={() => void reviews.fetchNextPage()}
                  loading={reviews.isFetchingNextPage}
                  className="mt-4"
                >
                  Show more reviews
                </Button>
              ) : null}
              {hasDemo ? (
                <p className="mt-6 text-sm text-text-muted">
                  Reviews marked “Demo review” are sample content for this demonstration store, not
                  feedback from real customers.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
