import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ExternalLink, ImageUp, LayoutTemplate, Trash2 } from 'lucide-react';
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
import { useAdminBlocks, useSaveBlock } from '@/lib/api/adminMarketing';
import type { AdminBlock } from '@/lib/api/peopleTypes';
import { applyApiErrors } from '@/lib/forms';
import { cn } from '@/lib/cn';
import { Callout } from '../../people-kit/Callout';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { formatDateTime } from '../../people-kit/datetime';
import { safeLinkError } from '../../people-kit/validators';
import { BLOCK_CATALOG, blockInfo } from '../blockCatalog';
import { BlockPreview } from './BlockPreview';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const blockSchema = z
  .object({
    eyebrow: z.string().trim().max(80, 'Keep the small heading under 80 characters.'),
    title: z.string().trim().max(160, 'Keep the title under 160 characters.'),
    body: z.string().max(5000, 'Keep the text under 5,000 characters.'),
    cta_label: z.string().trim().max(40, 'Keep the button text under 40 characters.'),
    cta_url: z.string().trim().max(300, 'Keep the link under 300 characters.'),
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const err = safeLinkError(v.cta_url);
    if (err) ctx.addIssue({ code: 'custom', path: ['cta_url'], message: err });
  });
type Values = z.infer<typeof blockSchema>;

const toValues = (b: AdminBlock): Values => ({
  eyebrow: b.eyebrow,
  title: b.title,
  body: b.body,
  cta_label: b.cta_label,
  cta_url: b.cta_url,
  is_active: b.is_active,
});

export function BlocksPanel() {
  const blocks = useAdminBlocks();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  if (blocks.isPending) return <Skeleton className="h-96 w-full" />;
  if (blocks.isError)
    return <ErrorState error={blocks.error} onRetry={() => void blocks.refetch()} />;
  const order = Object.keys(BLOCK_CATALOG);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const list = [...(blocks.data ?? [])].sort(
    (a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key),
  );
  const current = list.find((b) => b.key === selected) ?? list[0];
  if (!current)
    return (
      <EmptyState
        icon={<LayoutTemplate aria-hidden="true" />}
        title="No homepage blocks yet"
        description="Blocks are created by the site setup. Run the seed command or add them in the database."
      />
    );

  const choose = (key: string) => {
    if (key === current.key) return;
    if (dirty) setPending(key);
    else setSelected(key);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <nav aria-label="Homepage blocks" className="lg:sticky lg:top-20 lg:self-start">
        <ul className="grid gap-1">
          {list.map((b) => {
            const info = blockInfo(b.key);
            return (
              <li key={b.id}>
                <button
                  type="button"
                  aria-current={b.key === current.key ? 'true' : undefined}
                  onClick={() => choose(b.key)}
                  className={cn(
                    'flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left',
                    b.key === current.key
                      ? 'border-accent bg-accent-soft'
                      : 'border-transparent hover:bg-surface-sunken',
                  )}
                >
                  <span className="text-sm font-medium">{info.label}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                    {b.key}
                    {!b.is_active ? (
                      <Badge tone="neutral" size="sm">
                        Off
                      </Badge>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <BlockEditor key={current.id} block={current} onDirtyChange={setDirty} />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Discard unsaved changes?"
        description="You have edits on this block that have not been saved."
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          setSelected(pending);
          setDirty(false);
          setPending(null);
        }}
      />
    </div>
  );
}

function BlockEditor({
  block,
  onDirtyChange,
}: {
  block: AdminBlock;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const info = blockInfo(block.key);
  const save = useSaveBlock();
  const [formError, setFormError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileKey, setFileKey] = useState(0);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(blockSchema), defaultValues: toValues(block) });

  const imageDirty = file !== null || removeImage;
  useEffect(() => onDirtyChange(isDirty || imageDirty), [isDirty, imageDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => (filePreview ? URL.revokeObjectURL(filePreview) : undefined),
    [filePreview],
  );

  const values = useWatch({ control }) as Values;
  const imageUrl = filePreview ?? (removeImage ? null : block.image_url);
  const shows = (f: string) => info.fields === null || info.fields.includes(f as never);
  const unusedHint = (f: string) =>
    shows(f) ? undefined : 'The storefront does not show this field for this block.';

  const pickFile = (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      setFileError('Use a JPEG, PNG or WebP image.');
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setFileError('The image is larger than 5 MB. Choose a smaller file.');
      return;
    }
    setFile(f);
    setRemoveImage(false);
  };

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const saved = await save.mutateAsync({
        key: block.key,
        exists: true,
        fields: { ...v },
        image: file,
        removeImage,
      });
      reset(toValues(saved));
      setFile(null);
      setRemoveImage(false);
      setFileKey((k) => k + 1);
      toast.success(`${info.label} was saved. The homepage now shows the new version.`);
    } catch (e) {
      const msg = applyApiErrors(e, setError, [
        'eyebrow',
        'title',
        'body',
        'cta_label',
        'cta_url',
        'is_active',
      ]);
      setFormError(msg);
    }
  });

  return (
    <div className="grid min-w-0 content-start gap-5">
      <div>
        <h2 className="font-display text-h3">{info.label}</h2>
        <p className="text-sm text-text-muted">{info.where}</p>
        <p className="mt-1 text-sm text-text-muted">
          <code className="rounded-xs bg-surface-sunken px-1.5 py-0.5">{block.key}</code> · Last
          updated {formatDateTime(block.updated_at)}
          {info.href ? (
            <>
              {' · '}
              <Link
                to={info.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent-text underline underline-offset-4"
              >
                View on website <ExternalLink aria-hidden="true" className="size-3" />
                <span className="sr-only">(opens in a new tab)</span>
              </Link>
            </>
          ) : null}
        </p>
      </div>
      {info.fields === null ? (
        <Callout tone="warning" title="Not displayed yet" role="status">
          The storefront does not use this block at the moment, so changes will not be visible to
          visitors.
        </Callout>
      ) : null}
      {formError ? <FormAlert>{formError}</FormAlert> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <form
          onSubmit={onSubmit}
          noValidate
          aria-label={`Edit ${info.label}`}
          className="grid content-start gap-4"
        >
          <Field
            label="Small heading (eyebrow)"
            error={errors.eyebrow?.message}
            hint={unusedHint('eyebrow')}
          >
            <Input {...register('eyebrow')} maxLength={80} />
          </Field>
          <Field label="Title" error={errors.title?.message} hint={unusedHint('title')}>
            <Input {...register('title')} maxLength={160} />
          </Field>
          <Field
            label="Text"
            error={errors.body?.message}
            hint={unusedHint('body') ?? 'Plain text. Leave a blank line to start a new paragraph.'}
          >
            <Textarea rows={6} {...register('body')} />
          </Field>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Image</legend>
            {!shows('image') ? (
              <p className="text-sm text-text-muted">
                The storefront does not show an image for this block.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    key={fileKey}
                    ref={fileInput}
                    id={`block-image-${block.id}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<ImageUp aria-hidden="true" className="size-4" />}
                    onClick={() => fileInput.current?.click()}
                  >
                    {imageUrl ? 'Replace image' : 'Upload image'}
                  </Button>
                  {imageUrl ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
                      onClick={() => {
                        setFile(null);
                        setRemoveImage(true);
                      }}
                    >
                      Remove image
                    </Button>
                  ) : null}
                  {file ? <span className="text-sm text-text-muted">{file.name}</span> : null}
                </div>
                <p className="text-sm text-text-muted">JPEG, PNG or WebP, up to 5 MB.</p>
                {fileError ? (
                  <p role="alert" className="text-sm font-medium text-danger">
                    {fileError}
                  </p>
                ) : null}
              </>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Button text" error={errors.cta_label?.message} hint={unusedHint('cta')}>
              <Input {...register('cta_label')} maxLength={40} />
            </Field>
            <Field
              label="Button link"
              error={errors.cta_url?.message}
              hint={
                unusedHint('cta') ?? 'A page on this site like /menu, or a full https:// address.'
              }
            >
              <Input {...register('cta_url')} maxLength={300} placeholder="/menu" />
            </Field>
          </div>

          <Switch
            label="Show this block"
            description="When off, the homepage falls back to its built-in text for this section."
            checked={values.is_active}
            onCheckedChange={(c) => setValue('is_active', c, { shouldDirty: true })}
          />

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            {isDirty || imageDirty ? (
              <span role="status" className="mr-auto text-sm font-medium text-warning">
                Unsaved changes
              </span>
            ) : null}
            <Button
              variant="secondary"
              disabled={(!isDirty && !imageDirty) || save.isPending}
              onClick={() => {
                reset(toValues(block));
                setFile(null);
                setRemoveImage(false);
              }}
            >
              Discard changes
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!isDirty && !imageDirty}>
              Save block
            </Button>
          </div>
        </form>

        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-text-muted uppercase">
            Preview
          </h3>
          <BlockPreview
            blockKey={block.key}
            values={{
              eyebrow: values.eyebrow,
              title: values.title,
              body: values.body,
              cta_label: values.cta_label,
              cta_url: values.cta_url,
              imageUrl,
              active: values.is_active,
            }}
          />
        </div>
      </div>
    </div>
  );
}
