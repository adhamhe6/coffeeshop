import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Switch, toast } from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import {
  adminCatalogApi,
  useInvalidateCatalog,
  type AdminModifierGroup,
  type AdminModifierOption,
} from '@/lib/api/adminCatalog';
import { applyApiErrors } from '@/lib/forms';
import { defaultsProblem } from '../groupRules';
import { normaliseDelta, validateDelta } from '../optionRules';

interface Values {
  name: string;
  price_delta: string;
  is_default: boolean;
  is_active: boolean;
  is_available: boolean;
}

interface OptionDialogProps {
  group: AdminModifierGroup;
  /** `null` adds an option. */
  option: AdminModifierOption | null;
  onClose: () => void;
}

export function OptionDialog({ group, option, onClose }: OptionDialogProps) {
  const invalidate = useInvalidateCatalog();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: {
      name: option?.name ?? '',
      price_delta: option?.price_delta ?? '0.00',
      is_default: option?.is_default ?? false,
      is_active: option?.is_active ?? true,
      is_available: option?.is_available ?? true,
    },
  });

  const isDefault = useWatch({ control, name: 'is_default' });
  const isAvailable = useWatch({ control, name: 'is_available' });
  const isActive = useWatch({ control, name: 'is_active' });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const delta = normaliseDelta(v.price_delta);
    if (!v.name.trim()) return setError('name', { message: 'Enter a name.' });
    const deltaProblem = validateDelta(v.price_delta);
    if (deltaProblem || delta === null)
      return setError('price_delta', { message: deltaProblem ?? 'Invalid.' });
    if (group.selection_type === 'MULTIPLE' && v.is_default && v.is_active) {
      const others = group.options.filter((o) => o.id !== option?.id);
      const problem = defaultsProblem(
        [...others, { is_default: true, is_active: true }],
        group.max_select,
      );
      if (problem) return setError('is_default' as never, { message: problem });
    }
    try {
      const body = { ...v, name: v.name.trim(), price_delta: delta };
      if (option) await adminCatalogApi.updateOption(group.id, option.id, body);
      else await adminCatalogApi.createOption(group.id, body);
      await invalidate(['groups']);
      toast.success(option ? `${body.name} was saved.` : `${body.name} was added.`);
      onClose();
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['name', 'price_delta']));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={option ? `Edit ${option.name}` : `Add option to ${group.name}`}
        description="Price adjustments are added to the product's base price. Use a negative number for a discount."
      >
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          <Field label="Name" required error={errors.name?.message}>
            <Input {...register('name')} autoComplete="off" />
          </Field>
          <Field
            label="Price adjustment"
            required
            error={errors.price_delta?.message}
            hint="0.00 for no change, 0.60 to add sixty cents, -0.50 to take fifty off."
          >
            <Input
              {...register('price_delta', { validate: (v) => validateDelta(v) ?? true })}
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
            />
          </Field>
          <Switch
            label="Selected by default"
            description={
              group.selection_type === 'SINGLE'
                ? 'Choosing this clears the default on the other options.'
                : `Up to ${group.max_select} option(s) can be pre-selected.`
            }
            checked={isDefault}
            onCheckedChange={(v) => setValue('is_default', v, { shouldDirty: true })}
          />
          {(errors as Record<string, { message?: string }>).is_default ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {(errors as Record<string, { message?: string }>).is_default?.message}
            </p>
          ) : null}
          <Switch
            label="Available"
            description="Turn off when you have run out (for example oat milk). Customers see it greyed out."
            checked={isAvailable}
            onCheckedChange={(v) => setValue('is_available', v, { shouldDirty: true })}
          />
          <Switch
            label="Active"
            description="Off removes the option from the product page entirely."
            checked={isActive}
            onCheckedChange={(v) => setValue('is_active', v, { shouldDirty: true })}
          />
          <DialogFooter className="sticky -bottom-5 -mx-6 -mb-5 bg-surface-raised">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {option ? 'Save option' : 'Add option'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
