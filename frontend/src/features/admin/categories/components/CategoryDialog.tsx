import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Switch,
  Textarea,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { adminCatalogApi, useInvalidateCatalog, type AdminCategory } from '@/lib/api/adminCatalog';
import { applyApiErrors } from '@/lib/forms';
import { errorText } from '../../catalog-kit/errors';
import { ImageUploader } from '../../catalog-kit/ImageUploader';
import { slugify } from '../../products/productForm';
import { useObjectUrl } from '../../products/components/useObjectUrl';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(80, 'Keep the name under 80 characters.'),
  slug: z
    .string()
    .trim()
    .regex(/^[-a-zA-Z0-9_]*$/, 'Use letters, numbers, hyphens and underscores only.'),
  description: z.string().max(300, 'Keep the description under 300 characters.'),
  is_active: z.boolean(),
  is_featured: z.boolean(),
});
type Values = z.infer<typeof schema>;

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` creates a category. */
  category: AdminCategory | null;
}

export function CategoryDialog({ open, onOpenChange, category }: CategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={category ? `Edit ${category.name}` : 'New category'}
        description="Categories group the menu. Hidden categories hide all of their products from customers."
      >
        <CategoryForm
          key={category?.id ?? 'new'}
          category={category}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  category,
  onDone,
}: {
  category: AdminCategory | null;
  onDone: () => void;
}) {
  const invalidate = useInvalidateCatalog();
  const [formError, setFormError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const stagedUrl = useObjectUrl(file);
  const [image, setImage] = useState<string | null>(category?.image ?? null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: category?.name ?? '',
      slug: category?.slug ?? '',
      description: category?.description ?? '',
      is_active: category?.is_active ?? true,
      is_featured: category?.is_featured ?? false,
    },
  });
  const {
    register,
    handleSubmit,
    setError,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = form;
  const name = useWatch({ control, name: 'name' });
  const isActive = useWatch({ control, name: 'is_active' });
  const isFeatured = useWatch({ control, name: 'is_featured' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const body = { ...values, slug: values.slug.trim().toLowerCase() };
      const saved = category
        ? await adminCatalogApi.updateCategory(category.id, body)
        : await adminCatalogApi.createCategory(body);
      if (!category && file) {
        try {
          await adminCatalogApi.uploadCategoryImage(saved.id, file);
        } catch (e) {
          toast.warning(`The category was created but its image was not uploaded: ${errorText(e)}`);
        }
      }
      await invalidate(['categories']);
      toast.success(`${saved.name} was ${category ? 'saved' : 'created'}.`);
      onDone();
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['name', 'slug', 'description']));
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <Field label="Name" required error={errors.name?.message}>
        <Input {...register('name')} autoComplete="off" />
      </Field>
      <Field
        label="Slug"
        error={errors.slug?.message}
        hint={`Used in the menu URL. Leave blank to generate one${name ? ` (${slugify(name)})` : ''}.`}
      >
        <Input {...register('slug')} autoComplete="off" className="font-mono" />
      </Field>
      <Field
        label="Description"
        error={errors.description?.message}
        hint="Optional, shown on the category page."
      >
        <Textarea {...register('description')} rows={2} />
      </Field>
      <Switch
        label="Visible on the storefront"
        description="Off hides the category and all of its products."
        checked={isActive}
        onCheckedChange={(v) => setValue('is_active', v, { shouldDirty: true })}
      />
      <Switch
        label="Featured"
        description="Eligible for featured placements."
        checked={isFeatured}
        onCheckedChange={(v) => setValue('is_featured', v, { shouldDirty: true })}
      />
      <div>
        <p className="mb-2 text-sm font-medium">Image</p>
        {category ? (
          <ImageUploader
            label="Category image"
            src={image}
            aspect="3/2"
            onSelect={async (f) => {
              const res = await adminCatalogApi.uploadCategoryImage(category.id, f);
              setImage(res.image);
              void invalidate(['categories']);
              toast.success('Category image updated.');
            }}
            onRemove={async () => {
              await adminCatalogApi.removeCategoryImage(category.id);
              setImage(null);
              void invalidate(['categories']);
            }}
          />
        ) : (
          <ImageUploader
            label="Category image"
            src={stagedUrl}
            aspect="3/2"
            hint="JPEG, PNG or WebP, up to 5 MB. Uploaded when you create the category."
            onSelect={(f) => setFile(f)}
            onRemove={file ? () => setFile(null) : undefined}
          />
        )}
      </div>
      <DialogFooter className="sticky -bottom-5 -mx-6 -mb-5 bg-surface-raised">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {category ? 'Save category' : 'Create category'}
        </Button>
      </DialogFooter>
    </form>
  );
}
