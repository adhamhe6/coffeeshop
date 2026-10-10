import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImageUp, OctagonAlert, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { useAdminSettings, useSaveSettings } from '@/lib/api/adminSettings';
import { describeError, isApiError } from '@/lib/api/errors';
import type { AdminStoreSettings } from '@/lib/api/peopleTypes';
import { applyApiErrors } from '@/lib/forms';
import { useSeo } from '@/hooks/useSeo';
import { cn } from '@/lib/cn';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { Callout } from '../../people-kit/Callout';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { formatDateTime } from '../../people-kit/datetime';
import { PaymentMethodsField } from '../components/PaymentMethodsField';
import {
  diffSettings,
  makeSettingsSchema,
  settingsToValues,
  taxFieldsChanged,
  type SettingsValues,
} from '../settingsLogic';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function SettingsPage() {
  useSeo({ title: 'Store settings', noindex: true });
  const query = useAdminSettings();
  if (query.isPending) {
    return (
      <div aria-busy="true" className="grid gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div>
        <AdminPageHeader title="Store settings" />
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </div>
    );
  }
  return <SettingsForm settings={query.data} />;
}

function SettingsForm({ settings }: { settings: AdminStoreSettings }) {
  const save = useSaveSettings();
  const saved = useMemo(() => settingsToValues(settings), [settings]);
  const schema = useMemo(() => makeSettingsSchema(saved), [saved]);
  const [formError, setFormError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [killDialog, setKillDialog] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileKey, setFileKey] = useState(0);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<SettingsValues>({ resolver: zodResolver(schema), defaultValues: saved });

  useEffect(() => reset(saved), [saved, reset]);

  const values = useWatch({ control }) as SettingsValues;
  const taxChanged = taxFieldsChanged(saved, values);
  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => (filePreview ? URL.revokeObjectURL(filePreview) : undefined),
    [filePreview],
  );
  const logoSrc = filePreview ?? (removeLogo ? null : settings.logo_url);
  const logoDirty = file !== null || removeLogo;

  const pickLogo = (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!LOGO_TYPES.includes(f.type)) return setFileError('Use a JPEG, PNG or WebP image.');
    if (f.size > MAX_LOGO_BYTES)
      return setFileError('The image is larger than 5 MB. Choose a smaller file.');
    setFile(f);
    setRemoveLogo(false);
  };

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync({
        patch: diffSettings(saved, v),
        logo: file,
        removeLogo,
      });
      setFile(null);
      setRemoveLogo(false);
      setFileKey((k) => k + 1);
      toast.success('Store settings saved.');
    } catch (e) {
      setFormError(
        applyApiErrors(e, setError, [
          'brand_name',
          'tagline',
          'legal_name',
          'support_email',
          'support_phone',
          'business_address',
          'currency',
          'tax_rate',
          'tax_label',
          'allowed_checkout_methods',
        ]),
      );
    }
  });

  const setOrdering = async (enabled: boolean) => {
    setKillError(null);
    try {
      await save.mutateAsync({ patch: { ordering_enabled: enabled } });
      toast.success(
        enabled
          ? 'Ordering is back on. Customers can check out again.'
          : 'Ordering is paused. Customers cannot check out.',
      );
      setKillDialog(false);
    } catch (e) {
      const message = isApiError(e) ? e.message : describeError(e).message;
      setKillError(message);
      if (enabled) toast.error(message);
    }
  };

  const dirty = isDirty || logoDirty;

  return (
    <div>
      <AdminPageHeader
        title="Store settings"
        description={`How the store presents itself, charges tax and takes orders. Last updated ${formatDateTime(settings.updated_at)}.`}
      />

      {/* Global kill switch — saved immediately, separate from the form below. */}
      <section
        aria-labelledby="ordering-h"
        className={cn(
          'mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4',
          settings.ordering_enabled
            ? 'border-border bg-surface-raised'
            : 'border-danger/40 bg-danger-bg',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {settings.ordering_enabled ? (
            <PlayCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          ) : (
            <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
          )}
          <div>
            <h2 id="ordering-h" className="font-display text-h4 font-semibold">
              {settings.ordering_enabled
                ? 'Ordering is on'
                : 'Ordering is paused for the whole store'}
            </h2>
            <p className="mt-0.5 max-w-[60ch] text-sm text-text-muted">
              {settings.ordering_enabled
                ? 'Customers can place orders at every branch that is open. Use the pause switch in an emergency (stock problem, outage, shop closed).'
                : 'Customers can still browse but checkout is blocked at every branch until you resume ordering.'}
            </p>
          </div>
        </div>
        {settings.ordering_enabled ? (
          <Button
            variant="danger"
            size="sm"
            leadingIcon={<PauseCircle aria-hidden="true" className="size-4" />}
            onClick={() => {
              setKillError(null);
              setKillDialog(true);
            }}
          >
            Pause all ordering
          </Button>
        ) : (
          <Button
            size="sm"
            leadingIcon={<PlayCircle aria-hidden="true" className="size-4" />}
            loading={save.isPending}
            onClick={() => void setOrdering(true)}
          >
            Resume ordering
          </Button>
        )}
      </section>

      <form onSubmit={onSubmit} noValidate aria-label="Store settings" className="grid gap-6">
        {formError ? <FormAlert>{formError}</FormAlert> : null}

        <Card title="Brand">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand name" required error={errors.brand_name?.message}>
              <Input {...register('brand_name')} maxLength={80} />
            </Field>
            <Field label="Tagline" error={errors.tagline?.message}>
              <Input {...register('tagline')} maxLength={160} />
            </Field>
            <Field
              label="Legal business name"
              error={errors.legal_name?.message}
              hint="Used on invoices and legal pages."
            >
              <Input {...register('legal_name')} maxLength={160} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Logo</legend>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center rounded-md border border-border bg-surface-sunken p-2">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt="Current logo"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-sm text-text-muted">No logo uploaded</span>
                )}
              </div>
              <input
                key={fileKey}
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Logo file"
                tabIndex={-1}
                onChange={(e) => pickLogo(e.target.files?.[0])}
              />
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ImageUp aria-hidden="true" className="size-4" />}
                onClick={() => fileInput.current?.click()}
              >
                {logoSrc ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logoSrc ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
                  onClick={() => {
                    setFile(null);
                    setRemoveLogo(true);
                  }}
                >
                  Remove logo
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-text-muted">
              JPEG, PNG or WebP, up to 5 MB. Applied when you save.
            </p>
            {fileError ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {fileError}
              </p>
            ) : null}
          </fieldset>
        </Card>

        <Card title="Contact details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Support email"
              error={errors.support_email?.message}
              hint="Shown to customers and used as the reply address."
            >
              <Input type="email" {...register('support_email')} maxLength={254} />
            </Field>
            <Field label="Support phone" error={errors.support_phone?.message}>
              <Input type="tel" {...register('support_phone')} maxLength={40} />
            </Field>
          </div>
          <Field
            label="Business address"
            error={errors.business_address?.message}
            hint="Shown in the footer and on receipts."
          >
            <Textarea rows={3} {...register('business_address')} />
          </Field>
        </Card>

        <Card title="Currency and tax">
          <Callout tone="warning" title="Confirm your legal tax requirements" role="note">
            The tax rate that came with this demo is a <strong>placeholder</strong>, not advice.
            Check the rate, the label and whether your prices include tax with your accountant or
            tax authority before you take real orders.
          </Callout>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Currency"
              required
              error={errors.currency?.message}
              hint="3-letter code, e.g. USD. Changing it does not convert existing prices or past orders."
            >
              <Input
                {...register('currency')}
                maxLength={3}
                className="uppercase"
                autoCapitalize="characters"
              />
            </Field>
            <Field label="Tax rate (%)" required error={errors.tax_rate?.message}>
              <Input inputMode="decimal" {...register('tax_rate')} />
            </Field>
            <Field
              label="Tax label"
              required
              error={errors.tax_label?.message}
              hint="How it appears on receipts."
            >
              <Input {...register('tax_label')} maxLength={30} />
            </Field>
          </div>
          <Controller
            control={control}
            name="prices_include_tax"
            render={({ field }) => (
              <Switch
                label="Menu prices already include tax"
                description="Off: tax is added on top at checkout. On: the tax shown is part of the listed price."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          {taxChanged ? (
            <Controller
              control={control}
              name="tax_confirmed"
              render={({ field }) => (
                <div className="grid gap-1.5 rounded-md border border-warning/50 bg-warning-bg p-3">
                  <Checkbox
                    label="I have checked that these tax and currency settings meet my legal requirements."
                    checked={field.value}
                    invalid={Boolean(errors.tax_confirmed)}
                    onCheckedChange={(c) => field.onChange(c === true)}
                  />
                  {errors.tax_confirmed?.message ? (
                    <p role="alert" className="text-sm font-medium text-danger">
                      {errors.tax_confirmed.message}
                    </p>
                  ) : null}
                </div>
              )}
            />
          ) : null}
        </Card>

        <Card title="Orders and reviews">
          <Controller
            control={control}
            name="auto_confirm_paid_orders"
            render={({ field }) => (
              <Switch
                label="Confirm paid orders automatically"
                description="When a card payment succeeds the order moves to Confirmed without staff action. Cash orders still need confirming."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="enable_reviews"
            render={({ field }) => (
              <Switch
                label="Customer reviews"
                description="Allow customers to review products they bought. Staff approve reviews before they appear."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </Card>

        <Card title="Checkout">
          <Controller
            control={control}
            name="allowed_checkout_methods"
            render={({ field }) => (
              <PaymentMethodsField
                available={settings.available_checkout_methods}
                saved={settings.allowed_checkout_methods}
                value={field.value}
                onChange={field.onChange}
                error={errors.allowed_checkout_methods?.message}
              />
            )}
          />
        </Card>

        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-surface-raised/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          {dirty ? (
            <span role="status" className="mr-auto text-sm font-medium text-warning">
              Unsaved changes
            </span>
          ) : null}
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              reset(saved);
              setFile(null);
              setRemoveLogo(false);
              setFormError(null);
            }}
          >
            Discard changes
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            Save settings
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={killDialog}
        onOpenChange={setKillDialog}
        title="Pause all ordering?"
        description="Customers will not be able to check out anywhere until you resume. Orders already placed are not affected."
        confirmLabel="Pause all ordering"
        tone="danger"
        loading={save.isPending}
        error={killError}
        onConfirm={() => setOrdering(false)}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-surface-raised p-4 sm:p-5">
      <h2 className="font-display text-h4 font-semibold">{title}</h2>
      {children}
    </section>
  );
}
