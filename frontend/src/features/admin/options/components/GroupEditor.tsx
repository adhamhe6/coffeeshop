import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Money,
  RadioCard,
  RadioGroup,
  Switch,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import {
  adminCatalogApi,
  useInvalidateCatalog,
  type AdminModifierGroup,
  type AdminModifierOption,
  type SelectionType,
} from '@/lib/api/adminCatalog';
import { aqk } from '@/lib/api/adminKeys';
import { applyApiErrors } from '@/lib/forms';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { errorText } from '../../catalog-kit/errors';
import { MiniSwitch } from '../../catalog-kit/MiniSwitch';
import { SortableList } from '../../catalog-kit/SortableList';
import { normaliseGroupRules, selectionHint, validateGroupRules } from '../groupRules';
import { OptionDialog } from './OptionDialog';

interface GroupValues {
  name: string;
  display_name: string;
  selection_type: SelectionType;
  is_required: boolean;
  min_select: string;
  max_select: string;
  is_active: boolean;
}

const toValues = (g: AdminModifierGroup | null): GroupValues => ({
  name: g?.name ?? '',
  display_name: g?.display_name ?? '',
  selection_type: g?.selection_type ?? 'SINGLE',
  is_required: g?.is_required ?? false,
  min_select: String(g?.min_select ?? 0),
  max_select: String(g?.max_select ?? 1),
  is_active: g?.is_active ?? true,
});

const rulesOf = (v: GroupValues) => ({
  selection_type: v.selection_type,
  is_required: v.is_required,
  min_select: v.min_select.trim() === '' ? NaN : Number(v.min_select),
  max_select: v.max_select.trim() === '' ? NaN : Number(v.max_select),
});

interface GroupEditorProps {
  /** `null` creates a group. */
  group: AdminModifierGroup | null;
  canManage: boolean;
  onCreated: (id: number) => void;
  onDeleted: () => void;
}

export function GroupEditor({ group, canManage, onCreated, onDeleted }: GroupEditorProps) {
  const invalidate = useInvalidateCatalog();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [optionDialog, setOptionDialog] = useState<AdminModifierOption | 'new' | null>(null);
  const [deleteGroup, setDeleteGroup] = useState(false);
  const [deleteOption, setDeleteOption] = useState<AdminModifierOption | null>(null);

  const form = useForm<GroupValues>({ defaultValues: toValues(group), mode: 'onChange' });
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = form;
  const values = useWatch({ control }) as GroupValues;
  const ruleErrors = validateGroupRules(rulesOf(values));
  const single = values.selection_type === 'SINGLE';

  const applyRules = (patch: Partial<GroupValues>) => {
    const next = { ...values, ...patch };
    const n = normaliseGroupRules(rulesOf(next));
    for (const [k, v] of Object.entries(patch))
      setValue(k as keyof GroupValues, v as never, { shouldDirty: true });
    if (Number.isFinite(n.min_select))
      setValue('min_select', String(n.min_select), { shouldDirty: true, shouldValidate: true });
    if (Number.isFinite(n.max_select))
      setValue('max_select', String(n.max_select), { shouldDirty: true, shouldValidate: true });
  };

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    if (!v.name.trim()) return setError('name', { message: 'Enter an internal name.' });
    if (!v.display_name.trim())
      return setError('display_name', { message: 'Enter the name customers see.' });
    if (Object.keys(ruleErrors).length) return;
    const body = {
      name: v.name.trim(),
      display_name: v.display_name.trim(),
      selection_type: v.selection_type,
      is_required: v.is_required,
      min_select: Number(v.min_select),
      max_select: Number(v.max_select),
      is_active: v.is_active,
    };
    try {
      const saved = group
        ? await adminCatalogApi.updateGroup(group.id, body)
        : await adminCatalogApi.createGroup(body);
      await invalidate(['groups']);
      reset(toValues(saved));
      toast.success(`${saved.name} was ${group ? 'saved' : 'created'}.`);
      if (!group) onCreated(saved.id);
    } catch (e) {
      setFormError(
        applyApiErrors(e, setError, ['name', 'display_name', 'min_select', 'max_select']),
      );
    }
  });

  const patchOption = (id: number, patch: Partial<AdminModifierOption>) =>
    qc.setQueryData<AdminModifierGroup[]>(aqk.groups.all, (old) =>
      old?.map((g) =>
        g.id === group?.id
          ? { ...g, options: g.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
          : g,
      ),
    );

  const toggleOption = useMutation({
    mutationFn: (v: {
      o: AdminModifierOption;
      field: 'is_available' | 'is_active';
      value: boolean;
    }) => adminCatalogApi.updateOption(group?.id ?? 0, v.o.id, { [v.field]: v.value }),
    onMutate: async ({ o, field, value }) => {
      await qc.cancelQueries({ queryKey: aqk.groups.all });
      const previous = qc.getQueryData<AdminModifierGroup[]>(aqk.groups.all);
      patchOption(o.id, { [field]: value });
      return { previous };
    },
    onError: (e, { o }, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.groups.all, ctx.previous);
      toast.error(`Could not update ${o.name}. ${errorText(e)}`);
    },
    onSuccess: (_d, { o, field, value }) =>
      toast.success(
        field === 'is_available'
          ? `${o.name} is ${value ? 'available again' : 'marked unavailable'}.`
          : `${o.name} is ${value ? 'active' : 'hidden from customers'}.`,
      ),
    onSettled: () => void invalidate(['groups']),
  });

  const reorder = useMutation({
    mutationFn: (next: AdminModifierOption[]) =>
      adminCatalogApi.reorderOptions(
        group?.id ?? 0,
        next.map((o) => o.id),
      ),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: aqk.groups.all });
      const previous = qc.getQueryData<AdminModifierGroup[]>(aqk.groups.all);
      qc.setQueryData<AdminModifierGroup[]>(aqk.groups.all, (old) =>
        old?.map((g) => (g.id === group?.id ? { ...g, options: next } : g)),
      );
      return { previous };
    },
    onError: (e, _n, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.groups.all, ctx.previous);
      toast.error(`Could not save the option order. ${errorText(e)}`);
    },
    onSettled: () => void invalidate(['groups']),
  });

  const disabled = !canManage;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border border-border bg-surface-raised p-4 sm:p-5"
        aria-label={group ? `Edit group ${group.name}` : 'New option group'}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-h4 font-semibold">
            {group ? group.name : 'New option group'}
          </h2>
          {group ? (
            <p className="text-sm text-text-muted">
              Used by {group.product_count} product{group.product_count === 1 ? '' : 's'}
              {group.product_count > 0 ? (
                <>
                  {' '}
                  (
                  <Link className="underline underline-offset-4" to="/admin/products">
                    see products
                  </Link>
                  )
                </>
              ) : null}
              . Changes apply to all of them.
            </p>
          ) : null}
        </div>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Internal name"
            required
            error={errors.name?.message}
            hint="For staff only, for example “Milk (espresso drinks)”."
          >
            <Input {...register('name')} disabled={disabled} autoComplete="off" />
          </Field>
          <Field
            label="Shown to customers as"
            required
            error={errors.display_name?.message}
            hint="For example “Milk”."
          >
            <Input {...register('display_name')} disabled={disabled} autoComplete="off" />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">How many can customers choose?</legend>
          <RadioGroup
            value={values.selection_type}
            onValueChange={(v) => applyRules({ selection_type: v as SelectionType })}
            disabled={disabled}
            className="sm:grid-cols-2"
            aria-label="Selection type"
          >
            <RadioCard
              value="SINGLE"
              title="Choose one"
              description="Radio buttons: size, temperature, milk."
            />
            <RadioCard
              value="MULTIPLE"
              title="Choose several"
              description="Checkboxes: extra shots, syrups, toppings."
            />
          </RadioGroup>
        </fieldset>
        <Switch
          label="Required"
          description="Customers must choose before adding to the cart."
          checked={values.is_required}
          disabled={disabled}
          onCheckedChange={(v) => applyRules({ is_required: v })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Minimum choices"
            error={ruleErrors.min_select ?? errors.min_select?.message}
            hint={single ? 'Set by “Required” for choose-one groups.' : undefined}
          >
            <Input
              {...register('min_select')}
              inputMode="numeric"
              disabled={disabled || single}
              invalid={Boolean(ruleErrors.min_select)}
            />
          </Field>
          <Field
            label="Maximum choices"
            error={ruleErrors.max_select ?? errors.max_select?.message}
            hint={single ? 'Choose-one groups allow exactly one.' : undefined}
          >
            <Input
              {...register('max_select')}
              inputMode="numeric"
              disabled={disabled || single}
              invalid={Boolean(ruleErrors.max_select)}
            />
          </Field>
        </div>
        {Object.keys(ruleErrors).length === 0 ? (
          <p className="text-sm text-text-muted">
            Customers will see:{' '}
            <strong className="font-medium text-text">{selectionHint(rulesOf(values))}</strong>
          </p>
        ) : null}
        <Switch
          label="Active"
          description="Off hides the whole group from every product that uses it."
          checked={values.is_active}
          disabled={disabled}
          onCheckedChange={(v) => setValue('is_active', v, { shouldDirty: true })}
        />
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={(group !== null && !isDirty) || Object.keys(ruleErrors).length > 0}
            >
              {group ? 'Save group' : 'Create group'}
            </Button>
            {group ? (
              <Button
                variant="ghost"
                className="ml-auto text-danger"
                leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
                onClick={() => setDeleteGroup(true)}
              >
                Delete group
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>

      {group ? (
        <section
          aria-labelledby="options-title"
          className="rounded-lg border border-border bg-surface-raised p-4 sm:p-5"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="options-title" className="font-display text-h4 font-semibold">
              Options
            </h2>
            {canManage ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Plus aria-hidden="true" className="size-4" />}
                onClick={() => setOptionDialog('new')}
              >
                Add option
              </Button>
            ) : null}
          </div>
          {group.options.length === 0 ? (
            <p className="text-sm text-text-muted">
              No options yet. Add the choices customers can pick from.
            </p>
          ) : (
            <SortableList
              label={`Options of ${group.name}`}
              items={group.options}
              getId={(o) => o.id}
              getLabel={(o) => o.name}
              disabled={disabled || reorder.isPending}
              onReorder={(next) => reorder.mutate(next)}
              renderItem={(o) => (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <div className="min-w-32 flex-1">
                    <p
                      className={`font-medium ${o.is_active ? '' : 'text-text-muted line-through'}`}
                    >
                      {o.name}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                      <Money value={o.price_delta} signed />
                      {o.is_default ? (
                        <Badge size="sm" tone="accent">
                          Default
                        </Badge>
                      ) : null}
                      {!o.is_active ? (
                        <Badge size="sm" tone="neutral">
                          Hidden
                        </Badge>
                      ) : null}
                      {o.is_active && !o.is_available ? (
                        <Badge size="sm" tone="warning">
                          Unavailable
                        </Badge>
                      ) : null}
                    </p>
                  </div>
                  <MiniSwitch
                    checked={o.is_available}
                    disabled={disabled}
                    label={`Available: ${o.name}`}
                    onCheckedChange={(v) =>
                      toggleOption.mutate({ o, field: 'is_available', value: v })
                    }
                    text="Available"
                  />
                  <MiniSwitch
                    checked={o.is_active}
                    disabled={disabled}
                    label={`Active: ${o.name}`}
                    onCheckedChange={(v) =>
                      toggleOption.mutate({ o, field: 'is_active', value: v })
                    }
                    text="Active"
                  />
                  {canManage ? (
                    <div className="flex">
                      <IconButton
                        label={`Edit ${o.name}`}
                        size="icon-sm"
                        onClick={() => setOptionDialog(o)}
                        icon={<Pencil aria-hidden="true" className="size-4" />}
                      />
                      <IconButton
                        label={`Delete ${o.name}`}
                        size="icon-sm"
                        onClick={() => setDeleteOption(o)}
                        icon={<Trash2 aria-hidden="true" className="size-4" />}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            />
          )}
        </section>
      ) : null}

      {group && optionDialog ? (
        <OptionDialog
          group={group}
          option={optionDialog === 'new' ? null : optionDialog}
          onClose={() => setOptionDialog(null)}
        />
      ) : null}
      {group ? (
        <>
          <ConfirmDialog
            open={deleteGroup}
            onOpenChange={setDeleteGroup}
            title={`Delete ${group.name}?`}
            description={
              group.product_count > 0
                ? `It is attached to ${group.product_count} product(s), so it cannot be deleted. Detach it from those products, or deactivate the group instead.`
                : 'The group and its options are removed permanently. Groups that appear in order history cannot be deleted; deactivate them instead.'
            }
            confirmLabel="Delete group"
            destructive
            onConfirm={async () => {
              await adminCatalogApi.deleteGroup(group.id);
              await invalidate(['groups']);
              toast.success(`${group.name} was deleted.`);
              onDeleted();
            }}
          />
          <ConfirmDialog
            open={deleteOption !== null}
            onOpenChange={(o) => !o && setDeleteOption(null)}
            title={`Delete ${deleteOption?.name ?? 'option'}?`}
            description="Options that appear in order history cannot be deleted; mark them inactive instead."
            confirmLabel="Delete option"
            destructive
            onConfirm={async () => {
              if (!deleteOption) return;
              await adminCatalogApi.deleteOption(group.id, deleteOption.id);
              await invalidate(['groups']);
              toast.success(`${deleteOption.name} was deleted.`);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
