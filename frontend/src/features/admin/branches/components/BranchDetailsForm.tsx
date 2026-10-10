import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button, Field, Input, Switch, Textarea, toast } from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { adminBranchesApi, type AdminBranch } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { qk } from '@/lib/api/keys';
import { applyApiErrors } from '@/lib/forms';
import { errorText } from '../../catalog-kit/errors';
import { ImageUploader } from '../../catalog-kit/ImageUploader';
import { useObjectUrl } from '../../products/components/useObjectUrl';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Keep the name under 100 characters.'),
  code: z
    .string()
    .trim()
    .min(1, 'Enter a short code, for example DT.')
    .max(12, 'At most 12 characters.'),
  slug: z
    .string()
    .trim()
    .regex(/^[-a-zA-Z0-9_]*$/, 'Use letters, numbers, hyphens and underscores only.'),
  description: z.string(),
  address_line: z.string().trim().min(1, 'Enter the street address.'),
  city: z.string().trim().min(1, 'Enter the city.'),
  postal_code: z.string(),
  phone: z.string(),
  email: z.union([z.literal(''), z.string().email('Enter a valid email address.')]),
  timezone: z.string().trim().min(1, 'Enter a time zone such as America/New_York.'),
  prep_minutes: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Whole minutes, 0 to 240.')
    .refine((v) => Number(v) <= 240, 'Whole minutes, 0 to 240.'),
  is_placeholder_address: z.boolean(),
  is_active: z.boolean(),
});
type Values = z.infer<typeof schema>;

const timeZones = (): string[] => {
  try {
    return (
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? []
    );
  } catch {
    return [];
  }
};

interface BranchDetailsFormProps {
  /** `null` creates a branch (administrators only). */
  branch: AdminBranch | null;
  canManage: boolean;
  /** Code, slug and visibility can only be changed by administrators with access to every branch. */
  globalScope: boolean;
  onCreated: (id: number) => void;
}

export function BranchDetailsForm({
  branch,
  canManage,
  globalScope,
  onCreated,
}: BranchDetailsFormProps) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const stagedUrl = useObjectUrl(file);
  const [image, setImage] = useState(branch?.image ?? null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    setValue,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: branch?.name ?? '',
      code: branch?.code ?? '',
      slug: branch?.slug ?? '',
      description: branch?.description ?? '',
      address_line: branch?.address_line ?? '',
      city: branch?.city ?? '',
      postal_code: branch?.postal_code ?? '',
      phone: branch?.phone ?? '',
      email: branch?.email ?? '',
      timezone: branch?.timezone ?? 'America/New_York',
      prep_minutes: String(branch?.prep_minutes ?? 10),
      is_placeholder_address: branch?.is_placeholder_address ?? false,
      is_active: branch?.is_active ?? true,
    },
  });
  const isPlaceholder = useWatch({ control, name: 'is_placeholder_address' });
  const isActive = useWatch({ control, name: 'is_active' });
  const disabled = !canManage;
  const restricted = disabled || (branch !== null && !globalScope);
  const zones = timeZones();

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: aqk.branches.all });
    void qc.invalidateQueries({ queryKey: qk.branches.all });
  };

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        ...v,
        prep_minutes: Number(v.prep_minutes),
        slug: v.slug.trim().toLowerCase(),
      };
      if (branch && !globalScope) {
        // Branch managers cannot change these; leaving them out avoids a 403 for unchanged values.
        for (const k of ['code', 'slug', 'is_active']) delete body[k];
      }
      const saved = branch
        ? await adminBranchesApi.update(branch.id, body)
        : await adminBranchesApi.create(body);
      if (!branch && file) {
        try {
          await adminBranchesApi.uploadImage(saved.id, file);
        } catch (e) {
          toast.warning(`The branch was created but its image was not uploaded: ${errorText(e)}`);
        }
      }
      await refresh();
      reset(v);
      toast.success(`${saved.name} was ${branch ? 'saved' : 'created'}.`);
      if (!branch) onCreated(saved.id);
    } catch (e) {
      setFormError(
        applyApiErrors(e, setError, [
          'name',
          'code',
          'slug',
          'address_line',
          'city',
          'phone',
          'email',
          'timezone',
          'prep_minutes',
        ]),
      );
    }
  });

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      className="grid gap-4"
      aria-label="Branch details"
    >
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name')} disabled={disabled} autoComplete="off" />
        </Field>
        <Field
          label="Code"
          required
          error={errors.code?.message}
          hint={
            restricted
              ? 'Only administrators can change the code.'
              : 'Short and unique, for example DT. Used in order numbers.'
          }
        >
          <Input
            {...register('code')}
            disabled={restricted}
            autoComplete="off"
            className="font-mono uppercase"
          />
        </Field>
        <Field
          label="Slug"
          error={errors.slug?.message}
          hint={
            restricted
              ? 'Only administrators can change the slug.'
              : 'URL part for the location page. Blank = generated from the name.'
          }
        >
          <Input
            {...register('slug')}
            disabled={restricted}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Field label="Typical preparation time (minutes)" error={errors.prep_minutes?.message}>
          <Input {...register('prep_minutes')} disabled={disabled} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Description" hint="Shown on the location page.">
        <Textarea {...register('description')} disabled={disabled} rows={2} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Street address" required error={errors.address_line?.message}>
          <Input {...register('address_line')} disabled={disabled} autoComplete="off" />
        </Field>
        <Field label="City" required error={errors.city?.message}>
          <Input {...register('city')} disabled={disabled} autoComplete="off" />
        </Field>
        <Field label="Postal code" error={errors.postal_code?.message}>
          <Input {...register('postal_code')} disabled={disabled} autoComplete="off" />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} disabled={disabled} type="tel" autoComplete="off" />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input {...register('email')} disabled={disabled} type="email" autoComplete="off" />
        </Field>
        <Field
          label="Time zone"
          required
          error={errors.timezone?.message}
          hint="IANA name, for example Europe/Berlin. Hours and slots use it."
        >
          <Input {...register('timezone')} disabled={disabled} list="tz-list" autoComplete="off" />
          <datalist id="tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
      </div>
      <Switch
        label="Address is a placeholder"
        description="Marks the address as “replace before launch”. Turn off once it is the real one."
        checked={isPlaceholder}
        disabled={disabled}
        onCheckedChange={(v) => setValue('is_placeholder_address', v, { shouldDirty: true })}
      />
      <Switch
        label="Branch is active"
        description={
          globalScope
            ? 'Off hides the branch everywhere on the storefront.'
            : 'Only administrators can change this.'
        }
        checked={isActive}
        disabled={restricted}
        onCheckedChange={(v) => setValue('is_active', v, { shouldDirty: true })}
      />
      <div>
        <p className="mb-2 text-sm font-medium">Photo</p>
        {branch ? (
          <ImageUploader
            label="Branch photo"
            src={image}
            aspect="3/2"
            disabled={disabled}
            onSelect={async (f) => {
              const res = await adminBranchesApi.uploadImage(branch.id, f);
              setImage(res.image);
              void refresh();
              toast.success('Branch photo updated.');
            }}
            onRemove={async () => {
              await adminBranchesApi.removeImage(branch.id);
              setImage(null);
              void refresh();
            }}
          />
        ) : (
          <ImageUploader
            label="Branch photo"
            src={stagedUrl}
            aspect="3/2"
            hint="JPEG, PNG or WebP, up to 5 MB. Uploaded when you create the branch."
            onSelect={(f) => setFile(f)}
            onRemove={file ? () => setFile(null) : undefined}
          />
        )}
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={isSubmitting} disabled={branch !== null && !isDirty}>
            {branch ? 'Save details' : 'Create branch'}
          </Button>
          {branch && isDirty ? (
            <Button variant="ghost" onClick={() => reset()}>
              Discard changes
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-sm text-text-muted">
        Saved details appear on the storefront location page, in order emails and at checkout.
      </p>
    </form>
  );
}
