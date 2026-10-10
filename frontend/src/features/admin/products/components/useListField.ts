import { useFormContext } from 'react-hook-form';
import type { ProductFormValues } from '../productForm';

type ListName = 'allergens' | 'tags' | 'modifier_group_ids' | 'collection_ids';
type ListValue<N extends ListName> = ProductFormValues[N];

/** Read/write an array field of the product form as controlled state (marks the form dirty). */
export function useListField<N extends ListName>(name: N) {
  const { watch, setValue } = useFormContext<ProductFormValues>();
  const value = watch(name) as ListValue<N>;
  const set = (next: ListValue<N>) =>
    setValue(name, next as never, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  return [value, set] as const;
}
