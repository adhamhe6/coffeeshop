import { useEffect, useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ExternalLink, FileText } from 'lucide-react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { useAdminPages, useSavePage } from '@/lib/api/adminMarketing';
import type { AdminPage } from '@/lib/api/peopleTypes';
import { applyApiErrors } from '@/lib/forms';
import { cn } from '@/lib/cn';
import { Callout } from '../../people-kit/Callout';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { formatDateTime } from '../../people-kit/datetime';
import { MarkdownEditor } from './MarkdownEditor';

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a page title.')
    .max(160, 'Keep the title under 160 characters.'),
  summary: z.string().trim().max(300, 'Keep the summary under 300 characters.'),
  body_markdown: z.string().max(50_000, 'This page is too long (50,000 characters maximum).'),
  is_published: z.boolean(),
});
type Values = z.infer<typeof schema>;

const toValues = (p: AdminPage): Values => ({
  title: p.title,
  summary: p.summary,
  body_markdown: p.body_markdown,
  is_published: p.is_published,
});

export function PagesPanel() {
  const pages = useAdminPages();
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const list = pages.data ?? [];
  const current = list.find((p) => p.slug === selected) ?? list[0];

  if (pages.isPending) return <Skeleton className="h-96 w-full" />;
  if (pages.isError) return <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />;
  if (!current)
    return (
      <EmptyState
        icon={<FileText aria-hidden="true" />}
        title="No pages yet"
        description="Content pages (About, FAQ, Privacy…) are created by the site setup."
      />
    );

  const choose = (slug: string) => {
    if (slug === current.slug) return;
    if (dirty) setPendingSlug(slug);
    else setSelected(slug);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <nav aria-label="Pages" className="lg:sticky lg:top-20 lg:self-start">
        <ul className="grid gap-1">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-current={p.slug === current.slug ? 'page' : undefined}
                onClick={() => choose(p.slug)}
                className={cn(
                  'flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left',
                  p.slug === current.slug
                    ? 'border-accent bg-accent-soft'
                    : 'border-transparent hover:bg-surface-sunken',
                )}
              >
                <span className="text-sm font-medium">{p.title}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                  /{p.slug}
                  <Badge tone={p.is_published ? 'success' : 'neutral'} size="sm">
                    {p.is_published ? 'Published' : 'Hidden'}
                  </Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <PageEditor key={current.id} page={current} onDirtyChange={setDirty} />

      <ConfirmDialog
        open={pendingSlug !== null}
        onOpenChange={(o) => !o && setPendingSlug(null)}
        title="Discard unsaved changes?"
        description="You have edits on this page that have not been saved. Switching pages will lose them."
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          setSelected(pendingSlug);
          setDirty(false);
          setPendingSlug(null);
        }}
      />
    </div>
  );
}

function PageEditor({
  page,
  onDirtyChange,
}: {
  page: AdminPage;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const save = useSavePage();
  const [formError, setFormError] = useState<string | null>(null);
  const bodyId = useId();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(page) });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const body = useWatch({ control, name: 'body_markdown' });
  const published = useWatch({ control, name: 'is_published' });
  const isTemplate = /\[Template/i.test(body);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const saved = await save.mutateAsync({ id: page.id, payload: v });
      reset(toValues(saved));
      toast.success(
        `“${saved.title}” was saved${saved.is_published ? ' and is live.' : '. It is hidden from visitors.'}`,
      );
    } catch (e) {
      setFormError(
        applyApiErrors(e, setError, ['title', 'summary', 'body_markdown', 'is_published']),
      );
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={`Edit page ${page.title}`}
      className="grid min-w-0 content-start gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-h3">{page.title}</h2>
          <p className="text-sm text-text-muted">
            Address <code className="rounded-xs bg-surface-sunken px-1.5 py-0.5">/{page.slug}</code>
            {' · '}Last updated {formatDateTime(page.updated_at)}
          </p>
        </div>
        {page.is_published ? (
          <Link
            to={`/${page.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text underline underline-offset-4"
          >
            View on website <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
        ) : null}
      </div>

      {isTemplate ? (
        <Callout tone="warning" title="This page is still a template" role="status">
          It contains placeholder text marked “[Template…]”. Replace it with your real, legally
          reviewed wording before launch.
        </Callout>
      ) : null}
      {formError ? <FormAlert>{formError}</FormAlert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Page title" required error={errors.title?.message}>
          <Input {...register('title')} maxLength={160} />
        </Field>
        <Field
          label="Short summary"
          error={errors.summary?.message}
          hint="Used for search engines and link previews."
        >
          <Textarea rows={2} {...register('summary')} maxLength={300} className="min-h-0" />
        </Field>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={bodyId} className="text-sm font-medium">
          Page content
        </label>
        <Controller
          control={control}
          name="body_markdown"
          render={({ field }) => (
            <MarkdownEditor
              id={bodyId}
              value={field.value}
              onChange={field.onChange}
              invalid={Boolean(errors.body_markdown)}
            />
          )}
        />
        {errors.body_markdown?.message ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.body_markdown.message}
          </p>
        ) : null}
      </div>

      <Controller
        control={control}
        name="is_published"
        render={({ field }) => (
          <Switch
            label="Published"
            description={
              published
                ? 'Visitors can read this page.'
                : 'Hidden: the page address shows “not found” to visitors.'
            }
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        {isDirty ? (
          <span role="status" className="mr-auto text-sm font-medium text-warning">
            Unsaved changes
          </span>
        ) : null}
        <Button
          variant="secondary"
          disabled={!isDirty || save.isPending}
          onClick={() => reset(toValues(page))}
        >
          Discard changes
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!isDirty}>
          Save page
        </Button>
      </div>
    </form>
  );
}
