import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Checkbox, Field, Input, Select, Textarea, toast } from '@/design';
import {
  useCreateAddress,
  useDeliveryZones,
  useUpdateAddress,
  type Address,
  type AddressInput,
} from '@/lib/api';
import { applyApiErrors } from '@/lib/forms';
import { FormAlert } from './FormAlert';

const schema = z.object({
  label: z.string().trim().max(50, 'Keep the label under 50 characters.'),
  recipient_name: z
    .string()
    .trim()
    .min(1, 'Enter the name of the person receiving the order.')
    .max(150),
  phone: z
    .string()
    .trim()
    .min(1, 'Enter a phone number for the courier.')
    .regex(/^[0-9+()\-\s.]{5,30}$/, 'Enter a valid phone number.'),
  line1: z.string().trim().min(1, 'Enter the street address.').max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().min(1, 'Enter the city.').max(100),
  postal_code: z.string().trim().max(20),
  zone: z.string().min(1, 'Choose your delivery area.'),
  instructions: z.string().trim().max(300, 'Keep instructions under 300 characters.'),
  is_default: z.boolean(),
});
type Values = z.infer<typeof schema>;
const FIELDS = [
  'label',
  'recipient_name',
  'phone',
  'line1',
  'line2',
  'city',
  'postal_code',
  'zone',
  'instructions',
  'is_default',
] as const;

interface AddressFormProps {
  /** Present when editing. */
  address?: Address;
  defaults?: { recipient_name?: string; phone?: string; city?: string };
  /** Offered as the default when this is the customer's first address. */
  suggestDefault?: boolean;
  onSaved: (address: Address) => void;
  onCancel: () => void;
}

/** Add / edit a delivery address. The zone decides which locations can deliver there and at what fee. */
export function AddressForm({
  address,
  defaults,
  suggestDefault,
  onSaved,
  onCancel,
}: AddressFormProps) {
  const zones = useDeliveryZones();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: address?.label ?? '',
      recipient_name: address?.recipient_name ?? defaults?.recipient_name ?? '',
      phone: address?.phone ?? defaults?.phone ?? '',
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? '',
      city: address?.city ?? defaults?.city ?? '',
      postal_code: address?.postal_code ?? '',
      zone: address?.zone ? String(address.zone) : '',
      instructions: address?.instructions ?? '',
      is_default: address?.is_default ?? Boolean(suggestDefault),
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const body: Partial<AddressInput> = {
      ...values,
      zone: Number(values.zone),
    };
    try {
      const saved = address
        ? await update.mutateAsync({ id: address.id, body })
        : await create.mutateAsync(body);
      toast.success(address ? 'Address updated.' : 'Address saved.');
      onSaved(saved);
    } catch (e) {
      setFormError(applyApiErrors(e, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4" aria-label="Delivery address">
      <FormAlert>{formError}</FormAlert>
      <Field label="Label" hint="Optional, e.g. Home or Office." error={errors.label?.message}>
        <Input autoComplete="off" {...register('label')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Recipient name" required error={errors.recipient_name?.message}>
          <Input autoComplete="name" {...register('recipient_name')} />
        </Field>
        <Field label="Phone" required error={errors.phone?.message}>
          <Input type="tel" autoComplete="tel" inputMode="tel" {...register('phone')} />
        </Field>
      </div>
      <Field label="Street address" required error={errors.line1?.message}>
        <Input autoComplete="address-line1" {...register('line1')} />
      </Field>
      <Field label="Apartment, floor, building" error={errors.line2?.message}>
        <Input autoComplete="address-line2" {...register('line2')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" required error={errors.city?.message}>
          <Input autoComplete="address-level2" {...register('city')} />
        </Field>
        <Field label="Postal code" error={errors.postal_code?.message}>
          <Input autoComplete="postal-code" {...register('postal_code')} />
        </Field>
      </div>
      <Field
        label="Delivery area"
        required
        hint="Decides which locations deliver to you and the delivery fee."
        error={errors.zone?.message}
      >
        <Controller
          control={control}
          name="zone"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              placeholder={zones.isPending ? 'Loading areas…' : 'Choose an area'}
              options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: z.name }))}
              disabled={zones.isPending}
            />
          )}
        />
      </Field>
      <Field
        label="Delivery instructions"
        hint="Optional. Gate codes, which bell to ring."
        error={errors.instructions?.message}
      >
        <Textarea rows={2} className="min-h-16" {...register('instructions')} />
      </Field>
      <Controller
        control={control}
        name="is_default"
        render={({ field }) => (
          <Checkbox
            label="Use as my default address"
            checked={field.value}
            onCheckedChange={(v) => field.onChange(v === true)}
          />
        )}
      />
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting} loadingText="Saving…">
          {address ? 'Save address' : 'Add address'}
        </Button>
      </div>
    </form>
  );
}
