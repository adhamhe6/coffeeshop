import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sparkles } from 'lucide-react';
import { Button, Field, Input, Radio, RadioGroup, Switch, Textarea, toast } from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { useCouponCategories, useProductNames, useSaveCoupon } from '@/lib/api/adminMarketing';
import type { AdminCoupon } from '@/lib/api/peopleTypes';
import { applyApiErrors } from '@/lib/forms';
import { useMoney } from '@/hooks/useMoney';
import { Callout } from '../../people-kit/Callout';
import { useStoreTimeZone } from '../../people-kit/useStoreTimeZone';
import {
  couponStatus,
  describeCoupon,
  formToPayload,
  generateCouponCode,
  type CouponFormValues,
} from '../couponLogic';
import { CategoryPicker, ProductPicker } from './TargetPickers';
import { CouponStatusChips } from './CouponStatusChips';

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;

export const makeCouponSchema = (redeemed: number) =>
  z
    .object({
      code: z.string().trim(),
      name: z.string().trim().min(1, 'Give the coupon a name staff will recognise.').max(120),
      description: z.string().trim().max(300, 'Keep the description under 300 characters.'),
      discount_type: z.enum(['PERCENT', 'FIXED']),
      value: z.string().trim(),
      max_discount: z.string().trim(),
      min_order_total: z.string().trim(),
      applies_to: z.enum(['ALL', 'CATEGORIES', 'PRODUCTS']),
      category_ids: z.array(z.number()),
      product_ids: z.array(z.number()),
      first_order_only: z.boolean(),
      is_automatic: z.boolean(),
      starts_at: z.string(),
      ends_at: z.string(),
      usage_limit: z.string().trim(),
      per_customer_limit: z.string().trim(),
      is_active: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const add = (path: keyof CouponFormValues, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });

      if (!v.code && !v.is_automatic)
        add('code', 'Enter the code customers will type, or generate one.');
      else if (v.code && !CODE_RE.test(v.code))
        add('code', 'Use 3 to 40 letters, digits, - or _ (starting with a letter or digit).');

      if (!v.value) add('value', 'Enter the discount amount.');
      else if (!MONEY_RE.test(v.value)) add('value', 'Enter a number with up to 2 decimals.');
      else {
        const n = Number(v.value);
        if (n <= 0) add('value', 'The discount must be greater than zero.');
        else if (v.discount_type === 'PERCENT' && n > 100)
          add('value', 'A percentage cannot be more than 100.');
      }
      if (v.max_discount && (!MONEY_RE.test(v.max_discount) || Number(v.max_discount) <= 0))
        add('max_discount', 'Enter an amount above zero, or leave empty for no cap.');
      if (v.min_order_total && !MONEY_RE.test(v.min_order_total))
        add('min_order_total', 'Enter an amount (0 or more), or leave empty for none.');

      if (v.applies_to === 'CATEGORIES' && v.category_ids.length === 0)
        add('category_ids', 'Choose at least one category.');
      if (v.applies_to === 'PRODUCTS' && v.product_ids.length === 0)
        add('product_ids', 'Choose at least one product.');

      if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at)
        add('ends_at', 'The end must be after the start.');

      for (const f of ['usage_limit', 'per_customer_limit'] as const) {
        const raw = v[f];
        if (raw && (!/^\d+$/.test(raw) || Number(raw) < 1))
          add(f, 'Enter a whole number of 1 or more, or leave empty for no limit.');
      }
      if (v.usage_limit && /^\d+$/.test(v.usage_limit) && Number(v.usage_limit) < redeemed)
        add('usage_limit', `${redeemed} redemptions are already used; the limit cannot be lower.`);
    });

const FIELD_NAMES = [
  'code',
  'name',
  'description',
  'discount_type',
  'value',
  'max_discount',
  'min_order_total',
  'applies_to',
  'category_ids',
  'product_ids',
  'first_order_only',
  'is_automatic',
  'starts_at',
  'ends_at',
  'usage_limit',
  'per_customer_limit',
  'is_active',
] as const;

export function CouponForm({
  initial,
  coupon,
  heading,
}: {
  initial: CouponFormValues;
  /** Existing coupon (edit mode). */
  coupon?: AdminCoupon;
  heading?: string;
}) {
  const navigate = useNavigate();
  const save = useSaveCoupon();
  const money = useMoney();
  const { timeZone, label: tzLabel, source } = useStoreTimeZone();
  const [formError, setFormError] = useState<string | null>(null);
  const redeemed = coupon?.times_redeemed ?? 0;
  const schema = useMemo(() => makeCouponSchema(redeemed), [redeemed]);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<CouponFormValues>({ resolver: zodResolver(schema), defaultValues: initial });

  const values = useWatch({ control }) as CouponFormValues;
  const categories = useCouponCategories();
  const productNames = useProductNames(values.product_ids);

  const summary = describeCoupon(values, {
    money: (v) => money.format(v),
    timeZone,
    categoryNames: (categories.data ?? [])
      .filter((c) => values.category_ids.includes(c.id))
      .map((c) => c.name),
    productNames: values.product_ids.map((id) => productNames[id]).filter((n): n is string => !!n),
  });
  const payloadPreview = formToPayload(values, timeZone);
  const status = couponStatus({
    is_active: values.is_active,
    starts_at: payloadPreview.starts_at ?? null,
    ends_at: payloadPreview.ends_at ?? null,
    usage_limit: payloadPreview.usage_limit ?? null,
    times_redeemed: redeemed,
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync({ id: coupon?.id, payload: formToPayload(v, timeZone) });
      toast.success(coupon ? `Coupon ${coupon.code} was updated.` : 'Coupon created.');
      navigate('/admin/coupons');
    } catch (e) {
      // Server field errors land inline; anything unmapped (409, 403, network) becomes the page banner.
      setFormError(applyApiErrors(e, setError, FIELD_NAMES));
    }
  });

  const percent = values.discount_type === 'PERCENT';

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={heading ?? 'Coupon'}
      className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start"
    >
      <div className="grid gap-6">
        {formError ? <FormAlert>{formError}</FormAlert> : null}

        <Card title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Name"
              required
              error={errors.name?.message}
              hint="Internal name, e.g. “Autumn seasonal drinks”."
            >
              <Input {...register('name')} maxLength={120} />
            </Field>
            <Field
              label="Code"
              required={!values.is_automatic}
              error={errors.code?.message}
              hint={
                values.is_automatic
                  ? 'Optional for automatic promotions; a reference is generated if empty.'
                  : 'Customers type this at checkout. Not case sensitive.'
              }
            >
              <Input
                {...register('code')}
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                trailing={
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Sparkles aria-hidden="true" className="size-3.5" />}
                    onClick={() =>
                      setValue('code', generateCouponCode(), {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                  >
                    Generate
                  </Button>
                }
                className="pr-28 uppercase"
              />
            </Field>
          </div>
          <Field
            label="Description"
            error={errors.description?.message}
            hint="Optional. Shown to customers when the code is applied."
          >
            <Textarea rows={2} {...register('description')} maxLength={300} />
          </Field>
        </Card>

        <Card title="Discount">
          <Controller
            control={control}
            name="discount_type"
            render={({ field }) => (
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Type of discount</legend>
                <RadioGroup
                  className="grid-cols-1 gap-2 sm:grid-cols-2"
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-label="Type of discount"
                >
                  <Radio value="PERCENT" label="Percentage off" description="e.g. 15% off" />
                  <Radio
                    value="FIXED"
                    label="Fixed amount off"
                    description="e.g. a set amount off the order"
                  />
                </RadioGroup>
              </fieldset>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={percent ? 'Percent off' : 'Amount off'}
              required
              error={errors.value?.message}
            >
              <Input
                inputMode="decimal"
                {...register('value')}
                trailing={
                  percent ? (
                    <span className="pr-2 text-text-muted">%</span>
                  ) : (
                    <span className="pr-2 text-text-muted">{money.currency}</span>
                  )
                }
              />
            </Field>
            {percent ? (
              <Field
                label="Maximum discount"
                error={errors.max_discount?.message}
                hint="Optional cap per order."
              >
                <Input
                  inputMode="decimal"
                  {...register('max_discount')}
                  trailing={<span className="pr-2 text-text-muted">{money.currency}</span>}
                />
              </Field>
            ) : null}
            <Field
              label="Minimum order"
              error={errors.min_order_total?.message}
              hint="Subtotal needed to use it."
            >
              <Input
                inputMode="decimal"
                {...register('min_order_total')}
                trailing={<span className="pr-2 text-text-muted">{money.currency}</span>}
              />
            </Field>
          </div>
        </Card>

        <Card title="Applies to">
          <Controller
            control={control}
            name="applies_to"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                aria-label="What the discount applies to"
              >
                <Radio value="ALL" label="The whole order" />
                <Radio value="CATEGORIES" label="Selected categories" />
                <Radio value="PRODUCTS" label="Selected products" />
              </RadioGroup>
            )}
          />
          {values.applies_to === 'CATEGORIES' ? (
            <div className="grid gap-1.5">
              <CategoryPicker
                value={values.category_ids}
                onChange={(ids) =>
                  setValue('category_ids', ids, { shouldValidate: true, shouldDirty: true })
                }
              />
              {errors.category_ids?.message ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {errors.category_ids.message}
                </p>
              ) : null}
            </div>
          ) : null}
          {values.applies_to === 'PRODUCTS' ? (
            <div className="grid gap-1.5">
              <ProductPicker
                value={values.product_ids}
                onChange={(ids) =>
                  setValue('product_ids', ids, { shouldValidate: true, shouldDirty: true })
                }
              />
              {errors.product_ids?.message ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {errors.product_ids.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card title="Rules">
          <Controller
            control={control}
            name="first_order_only"
            render={({ field }) => (
              <Switch
                label="First order only"
                description="Only customers who have never completed an order can use it."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="is_automatic"
            render={({ field }) => (
              <Switch
                label="Apply automatically"
                description="No code to type: the discount is added at checkout when the rules match."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Total redemption limit"
              error={errors.usage_limit?.message}
              hint={
                redeemed
                  ? `${redeemed} used so far. Empty means unlimited.`
                  : 'Empty means unlimited.'
              }
            >
              <Input inputMode="numeric" {...register('usage_limit')} />
            </Field>
            <Field
              label="Limit per customer"
              error={errors.per_customer_limit?.message}
              hint="Empty means unlimited."
            >
              <Input inputMode="numeric" {...register('per_customer_limit')} />
            </Field>
          </div>
        </Card>

        <Card title="Schedule">
          <p className="text-sm text-text-muted">
            Times are in store time ({tzLabel}
            {source === 'browser' ? ', your browser’s zone because no branch zone is set' : ''}).
            Leave both empty to run it with no dates.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" error={errors.starts_at?.message}>
              <Input type="datetime-local" {...register('starts_at')} />
            </Field>
            <Field label="Ends" error={errors.ends_at?.message}>
              <Input type="datetime-local" {...register('ends_at')} />
            </Field>
          </div>
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <Switch
                label="Active"
                description="Switch off to pause the coupon without losing its history."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </Card>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => navigate('/admin/coupons')}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {coupon ? 'Save changes' : 'Create coupon'}
          </Button>
        </div>
      </div>

      <aside
        aria-label="Summary preview"
        className="order-first rounded-lg border border-accent/40 bg-accent-soft p-4 lg:sticky lg:top-20 lg:order-last"
      >
        <h2 className="text-sm font-semibold tracking-wide text-text-muted uppercase">
          What customers get
        </h2>
        <p data-testid="coupon-summary" className="mt-2 text-[0.9375rem] leading-relaxed text-text">
          {summary}
        </p>
        <div className="mt-3">
          <CouponStatusChips status={status} automatic={values.is_automatic} />
        </div>
        <p className="mt-3 text-xs text-text-muted">
          The exact discount on each order is always worked out by the server at checkout.
        </p>
        {coupon ? (
          <Callout className="mt-3" title="Already in use">
            {coupon.redemption_count} redemption{coupon.redemption_count === 1 ? '' : 's'}. Changing
            the discount does not alter past orders.
          </Callout>
        ) : null}
      </aside>
    </form>
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
