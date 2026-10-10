import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import { Info, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Field,
  IconButton,
  Input,
  Money,
  Select,
  Switch,
  Textarea,
  Checkbox,
} from '@/design';
import { useMoney } from '@/hooks/useMoney';
import { PRODUCT_TYPES } from '@/lib/api/adminCatalog';
import { ChipInput } from '../../catalog-kit/ChipInput';
import { normalisePrice, slugify, type ProductFormValues } from '../productForm';
import { SectionCard } from './SectionCard';
import { useEditor } from './editorContext';
import { useListField } from './useListField';

function currencySymbol(currency: string, locale: string): string {
  try {
    return (
      new Intl.NumberFormat(locale, { style: 'currency', currency })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}

export function BasicsSection() {
  const { product, isNew, readOnly, categories } = useEditor();
  const {
    register,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<ProductFormValues>();
  const name = watch('name');
  const slug = watch('slug');
  const short = watch('short_description');
  const [slugTouched, setSlugTouched] = useState(false);

  // New products: keep the slug in step with the name until the person edits the slug themselves.
  useEffect(() => {
    if (isNew && !slugTouched) setValue('slug', slugify(name), { shouldDirty: true });
  }, [name, isNew, slugTouched, setValue]);

  const suggestion = slugify(name);
  const slugChanged = !isNew && product && slug !== product.slug;

  return (
    <SectionCard
      id="basics"
      title="Basics"
      description="What the product is called and where it lives on the menu."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name')} disabled={readOnly} autoComplete="off" />
        </Field>
        <Field
          label="SKU"
          required
          error={errors.sku?.message}
          hint="Unique stock-keeping code, for example LC-0101."
        >
          <Input
            {...register('sku')}
            disabled={readOnly}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Field
          label="Slug"
          error={errors.slug?.message}
          hint={
            <>
              Product URL:{' '}
              <span className="font-mono">/p/{slug || suggestion || 'generated-from-name'}</span>.
              {isNew ? ' Leave blank to generate one from the name.' : null}
              {slugChanged ? ' Changing it breaks existing links to this product.' : null}
            </>
          }
          labelAction={
            !isNew && !readOnly && suggestion && suggestion !== slug ? (
              <button
                type="button"
                className="text-sm text-accent-text underline underline-offset-4"
                onClick={() =>
                  setValue('slug', suggestion, { shouldDirty: true, shouldValidate: true })
                }
              >
                Use “{suggestion}”
              </button>
            ) : null
          }
        >
          <Input
            {...register('slug', {
              onChange: () => setSlugTouched(true),
            })}
            disabled={readOnly}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Field label="Category" required error={errors.category?.message}>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={(v) => field.onChange(v)}
                placeholder="Choose a category"
                disabled={readOnly}
                options={categories.map((c) => ({
                  value: String(c.id),
                  label: c.is_active ? c.name : `${c.name} (hidden)`,
                }))}
              />
            )}
          />
        </Field>
        <Field label="Type" error={errors.product_type?.message}>
          <Controller
            control={control}
            name="product_type"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={readOnly}
                options={PRODUCT_TYPES}
              />
            )}
          />
        </Field>
      </div>
      <Field
        label="Short description"
        error={errors.short_description?.message}
        hint={`Shown on product cards. ${short.length}/200`}
      >
        <Textarea {...register('short_description')} disabled={readOnly} rows={2} maxLength={200} />
      </Field>
      <Field
        label="Description"
        error={errors.description?.message}
        hint="Shown on the product page. A blank line starts a new paragraph."
      >
        <Textarea {...register('description')} disabled={readOnly} rows={6} />
      </Field>
    </SectionCard>
  );
}

export function PricingSection() {
  const { product, readOnly } = useEditor();
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<ProductFormValues>();
  const money = useMoney();
  const price = watch('base_price');
  const normalised = normalisePrice(price);
  const changed = product && normalised !== null && normalised !== product.base_price;
  const symbol = currencySymbol(money.currency, money.locale);

  return (
    <SectionCard
      id="pricing"
      title="Pricing"
      description="The base price is what customers pay for the default size, before options."
    >
      <div className="max-w-xs">
        <Field
          label={`Base price (${money.currency})`}
          required
          error={errors.base_price?.message}
          hint="Up to two decimals, for example 4.50. Option price changes are added on top."
        >
          <Input
            {...register('base_price')}
            disabled={readOnly}
            inputMode="decimal"
            autoComplete="off"
            leading={<span aria-hidden="true">{symbol}</span>}
            className="tabular-nums"
          />
        </Field>
      </div>
      {changed ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-info/30 bg-info-bg p-3 text-sm text-info"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            Price change: <Money value={product.base_price} className="font-medium" /> →{' '}
            <Money value={normalised} className="font-medium" />. The change is recorded in the
            audit log with your name and applies to new carts and orders as soon as you save.
            Existing orders keep the price they were placed at.
          </p>
        </div>
      ) : null}
    </SectionCard>
  );
}

export function MerchandisingSection() {
  const { readOnly, tags, collections } = useEditor();
  const { control } = useFormContext<ProductFormValues>();
  const [tagValues, setTags] = useListField('tags');
  const [collectionIds, setCollectionIds] = useListField('collection_ids');

  const flag = (
    name: 'is_featured' | 'is_bestseller' | 'is_seasonal' | 'is_new',
    label: string,
    description: string,
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Switch
          label={label}
          description={description}
          checked={field.value}
          onCheckedChange={field.onChange}
          disabled={readOnly}
        />
      )}
    />
  );

  return (
    <SectionCard
      id="merchandising"
      title="Merchandising"
      description="Where this product is highlighted on the storefront."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {flag(
          'is_featured',
          'Featured',
          'Eligible for featured placements, such as the home page.',
        )}
        {flag('is_bestseller', 'Bestseller', 'Shows the Bestseller label on cards.')}
        {flag('is_seasonal', 'Seasonal', 'Part of the seasonal menu; shows the Seasonal label.')}
        {flag('is_new', 'New', 'Shows the New label on cards.')}
      </div>
      <Field
        label="Tags"
        hint="Press Enter or comma to add. Tags drive search and filters on the menu."
      >
        <ChipInput
          noun="tag"
          value={tagValues}
          onChange={setTags}
          disabled={readOnly}
          max={30}
          suggestions={tags.map((t) => t.name)}
          placeholder="e.g. vegan, hot, single-origin"
          validate={(v) => (v.length > 40 ? 'Tags can be at most 40 characters.' : null)}
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Collections</legend>
        {collections.length === 0 ? (
          <p className="text-sm text-text-muted">
            No collections yet. Create them under Collections.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {collections.map((c) => (
              <Checkbox
                key={c.id}
                label={c.name}
                description={c.is_active ? `${c.product_count} products` : 'Hidden collection'}
                checked={collectionIds.includes(c.id)}
                disabled={readOnly}
                onCheckedChange={(v) =>
                  setCollectionIds(
                    v === true ? [...collectionIds, c.id] : collectionIds.filter((x) => x !== c.id),
                  )
                }
              />
            ))}
          </div>
        )}
      </fieldset>
    </SectionCard>
  );
}

const ALLERGEN = /^[a-z][a-z -]{0,29}$/;

export function DetailsSection() {
  const { readOnly } = useEditor();
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ProductFormValues>();
  const [allergens, setAllergens] = useListField('allergens');
  const { fields, append, remove } = useFieldArray({ control, name: 'nutrition' });

  return (
    <SectionCard
      id="details"
      title="Details"
      description="Shown on the product page. Only enter values you have measured or can stand behind."
    >
      <Field
        label="Allergens"
        error={errors.allergens?.message}
        hint="Type an allergen and press Enter, for example milk, gluten, tree nuts."
      >
        <ChipInput
          noun="allergen"
          value={allergens}
          onChange={setAllergens}
          disabled={readOnly}
          max={20}
          normalise={(raw) => raw.trim().toLowerCase().replace(/\s+/g, ' ')}
          validate={(v) =>
            ALLERGEN.test(v) ? null : 'Use letters, spaces and hyphens only (30 characters max).'
          }
          suggestions={['milk', 'gluten', 'eggs', 'soy', 'tree nuts', 'peanuts', 'sesame']}
          placeholder="Add allergen"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Preparation (minutes)" error={errors.prep_minutes?.message}>
          <Input {...register('prep_minutes')} disabled={readOnly} inputMode="numeric" />
        </Field>
        <Field label="Calories (kcal)" error={errors.calories?.message}>
          <Input {...register('calories')} disabled={readOnly} inputMode="numeric" />
        </Field>
        <Field label="Caffeine (mg)" error={errors.caffeine_mg?.message}>
          <Input {...register('caffeine_mg')} disabled={readOnly} inputMode="numeric" />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Nutrition</legend>
        {typeof errors.nutrition?.message === 'string' ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.nutrition.message}
          </p>
        ) : null}
        {fields.length === 0 ? (
          <p className="text-sm text-text-muted">
            No entries. Add things like protein_g, sugar_g or serving_size.
          </p>
        ) : null}
        {fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
            <Field
              label={`Nutrition name ${i + 1}`}
              hideLabel
              error={errors.nutrition?.[i]?.key?.message}
            >
              <Input
                size="sm"
                placeholder="Name, e.g. sugar_g"
                {...register(`nutrition.${i}.key` as const)}
                disabled={readOnly}
              />
            </Field>
            <Field
              label={`Nutrition value ${i + 1}`}
              hideLabel
              error={errors.nutrition?.[i]?.value?.message}
            >
              <Input
                size="sm"
                placeholder="Value, e.g. 12"
                {...register(`nutrition.${i}.value` as const)}
                disabled={readOnly}
              />
            </Field>
            <IconButton
              label={`Remove nutrition entry ${i + 1}`}
              size="icon-sm"
              disabled={readOnly}
              onClick={() => remove(i)}
              icon={<Trash2 aria-hidden="true" className="size-4" />}
            />
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={readOnly || fields.length >= 20}
            onClick={() => append({ key: '', value: '' })}
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
          >
            Add entry
          </Button>
        </div>
      </fieldset>
    </SectionCard>
  );
}
