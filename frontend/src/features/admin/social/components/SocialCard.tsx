import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Badge, Button, Field, Input, SocialIcon, Switch, socialLabel, toast } from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { useDeleteSocial, useSaveSocial } from '@/lib/api/adminMarketing';
import { describeError, isApiError } from '@/lib/api/errors';
import type { AdminSocial, SocialPlatformKey } from '@/lib/api/peopleTypes';
import { applyApiErrors } from '@/lib/forms';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { httpUrlError, looksLikePlaceholderUrl } from '../../people-kit/validators';
import { TriangleAlert } from 'lucide-react';

const schema = z
  .object({
    url: z.string().trim().max(200, 'Keep the address under 200 characters.'),
    handle: z.string().trim().max(80, 'Keep the handle under 80 characters.'),
    sort_order: z.string().trim(),
    is_active: z.boolean(),
    is_placeholder: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const err = httpUrlError(v.url);
    if (err) ctx.addIssue({ code: 'custom', path: ['url'], message: err });
    if (v.sort_order && !/^\d+$/.test(v.sort_order))
      ctx.addIssue({ code: 'custom', path: ['sort_order'], message: 'Enter a whole number.' });
  });
type Values = z.infer<typeof schema>;

const toValues = (s: AdminSocial | undefined, nextOrder: number): Values => ({
  url: s?.url ?? '',
  handle: s?.handle ?? '',
  sort_order: String(s?.sort_order ?? nextOrder),
  is_active: s?.is_active ?? true,
  is_placeholder: s?.is_placeholder ?? false,
});

/** One platform: existing profile (edit/remove) or empty slot (add). */
export function SocialCard({
  platform,
  profile,
  nextOrder,
}: {
  platform: SocialPlatformKey;
  profile?: AdminSocial;
  nextOrder: number;
}) {
  const save = useSaveSocial();
  const del = useDeleteSocial();
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(profile, nextOrder),
  });
  useEffect(() => reset(toValues(profile, nextOrder)), [profile, nextOrder, reset]);

  const label = socialLabel(platform);
  const v = useWatch({ control }) as Values;
  const placeholder = v.is_placeholder || (v.url !== '' && looksLikePlaceholderUrl(v.url));

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync({
        id: profile?.id,
        payload: {
          platform,
          url: values.url,
          handle: values.handle,
          is_active: values.is_active,
          is_placeholder: values.is_placeholder,
          sort_order: values.sort_order ? Number(values.sort_order) : nextOrder,
        },
      });
      toast.success(`${label} link ${profile ? 'saved' : 'added'}.`);
    } catch (e) {
      setFormError(
        applyApiErrors(e, setError, ['url', 'handle', 'sort_order', 'is_active', 'is_placeholder']),
      );
    }
  });

  const titleId = `social-${platform}-title`;
  return (
    <section
      aria-labelledby={titleId}
      className="grid content-start gap-4 rounded-lg border border-border bg-surface-raised p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="flex items-center gap-2.5 font-display text-h4 font-semibold">
          <SocialIcon platform={platform} aria-hidden="true" className="size-5" />
          {label}
        </h2>
        <span className="flex flex-wrap gap-1.5">
          {!profile ? <Badge tone="neutral">Not added</Badge> : null}
          {profile && !v.is_active ? <Badge tone="neutral">Hidden</Badge> : null}
          {profile && v.is_active ? <Badge tone="success">Shown on website</Badge> : null}
        </span>
      </header>

      {placeholder && profile ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-bg p-3 text-sm"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Placeholder — replace before launch.</strong> This link does not go to a real{' '}
            {label} profile yet.
          </p>
        </div>
      ) : null}
      {formError ? <FormAlert>{formError}</FormAlert> : null}

      <form onSubmit={onSubmit} noValidate aria-label={`${label} profile`} className="grid gap-3">
        <Field
          label="Profile address"
          required
          error={errors.url?.message}
          hint="Must start with https:// (or http://)."
        >
          <Input
            type="url"
            inputMode="url"
            placeholder={`https://${platform === 'x' ? 'x.com' : `${platform}.com`}/yourbrand`}
            {...register('url', {
              onChange: (e) => {
                const value = (e.target as HTMLInputElement).value;
                // Typing a real address clears the placeholder flag (it can be re-ticked below).
                if (value && !looksLikePlaceholderUrl(value) && profile?.is_placeholder)
                  setValue('is_placeholder', false, { shouldDirty: true });
              },
            })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <Field
            label="Handle"
            error={errors.handle?.message}
            hint="Shown next to the icon, e.g. @lanterncoffee."
          >
            <Input {...register('handle')} maxLength={80} />
          </Field>
          <Field label="Order" error={errors.sort_order?.message}>
            <Input inputMode="numeric" {...register('sort_order')} />
          </Field>
        </div>
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <Switch
              label="Show on the website"
              description="Appears in the footer and contact page."
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
        {profile ? (
          <Controller
            control={control}
            name="is_placeholder"
            render={({ field }) => (
              <Switch
                label="This is still a placeholder"
                description="Keeps the “replace before launch” warning visible in the dashboard."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {profile ? (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => {
                setRemoveError(null);
                setRemoving(true);
              }}
              aria-label={`Remove ${label} link`}
            >
              Remove
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            loading={save.isPending}
            disabled={Boolean(profile) && !isDirty}
          >
            {profile ? `Save ${label}` : `Add ${label}`}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove the ${label} link?`}
        description="It disappears from the website. You can add it again later."
        confirmLabel="Remove link"
        tone="danger"
        loading={del.isPending}
        error={removeError}
        onConfirm={async () => {
          if (!profile) return;
          try {
            await del.mutateAsync(profile.id);
            toast.success(`${label} link removed.`);
            setRemoving(false);
          } catch (e) {
            setRemoveError(isApiError(e) ? e.message : describeError(e).message);
          }
        }}
      />
    </section>
  );
}
