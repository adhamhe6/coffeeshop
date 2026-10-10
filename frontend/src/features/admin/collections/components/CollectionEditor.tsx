import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Money,
  ProductImage,
  Switch,
  Textarea,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import {
  adminCatalogApi,
  useInvalidateCatalog,
  type AdminCollection,
  type AdminCollectionProduct,
} from '@/lib/api/adminCatalog';
import { applyApiErrors } from '@/lib/forms';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { errorText } from '../../catalog-kit/errors';
import { ImageUploader } from '../../catalog-kit/ImageUploader';
import { SortableList } from '../../catalog-kit/SortableList';
import { useObjectUrl } from '../../products/components/useObjectUrl';
import { slugify } from '../../products/productForm';
import { ProductPicker } from './ProductPicker';

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

interface CollectionEditorProps {
  /** `null` creates a collection. */
  collection: AdminCollection | null;
  canManage: boolean;
  onCreated: (id: number) => void;
  onDeleted: () => void;
}

export function CollectionEditor({
  collection,
  canManage,
  onCreated,
  onDeleted,
}: CollectionEditorProps) {
  const invalidate = useInvalidateCatalog();
  const [formError, setFormError] = useState<string | null>(null);
  const [products, setProducts] = useState<AdminCollectionProduct[]>(collection?.products ?? []);
  const [file, setFile] = useState<File | null>(null);
  const stagedUrl = useObjectUrl(file);
  const [image, setImage] = useState<string | null>(collection?.image ?? null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: collection?.name ?? '',
      slug: collection?.slug ?? '',
      description: collection?.description ?? '',
      is_active: collection?.is_active ?? true,
      is_featured: collection?.is_featured ?? false,
    },
  });
  const {
    register,
    handleSubmit,
    setError,
    reset,
    getValues,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  const isActive = useWatch({ control: form.control, name: 'is_active' });
  const isFeatured = useWatch({ control: form.control, name: 'is_featured' });

  const baseIds = collection?.product_ids ?? [];
  const productsChanged =
    products.length !== baseIds.length || products.some((p, i) => p.id !== baseIds[i]);
  const dirty = isDirty || productsChanged || file !== null;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const body = { ...values, slug: values.slug.trim().toLowerCase() };
      let saved: AdminCollection;
      if (collection) {
        saved = await adminCatalogApi.updateCollection(collection.id, body);
        if (productsChanged) {
          saved = await adminCatalogApi.replaceCollectionProducts(
            collection.id,
            products.map((p) => p.id),
          );
        }
      } else {
        saved = await adminCatalogApi.createCollection({
          ...body,
          product_ids: products.map((p) => p.id),
        });
        if (file) {
          try {
            await adminCatalogApi.uploadCollectionImage(saved.id, file);
          } catch (e) {
            toast.warning(
              `The collection was created but its image was not uploaded: ${errorText(e)}`,
            );
          }
        }
      }
      await invalidate(['collections']);
      reset({
        name: saved.name,
        slug: saved.slug,
        description: saved.description,
        is_active: saved.is_active,
        is_featured: saved.is_featured,
      });
      setProducts(saved.products);
      setFile(null);
      toast.success(`${saved.name} was ${collection ? 'saved' : 'created'}.`);
      if (!collection) onCreated(saved.id);
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['name', 'slug', 'description']));
    }
  });

  const disabled = !canManage;
  const name = getValues('name');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        aria-label={collection ? `Edit collection ${collection.name}` : 'New collection'}
        className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border border-border bg-surface-raised p-4 sm:p-5"
      >
        <h2 className="font-display text-h4 font-semibold">
          {collection?.name ?? 'New collection'}
        </h2>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required error={errors.name?.message}>
            <Input {...register('name')} disabled={disabled} autoComplete="off" />
          </Field>
          <Field
            label="Slug"
            error={errors.slug?.message}
            hint={`Leave blank to generate one${name ? ` (${slugify(name)})` : ''}.`}
          >
            <Input
              {...register('slug')}
              disabled={disabled}
              autoComplete="off"
              className="font-mono"
            />
          </Field>
        </div>
        <Field label="Description" error={errors.description?.message}>
          <Textarea {...register('description')} disabled={disabled} rows={2} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Switch
            label="Visible on the storefront"
            checked={isActive}
            disabled={disabled}
            onCheckedChange={(v) => setValue('is_active', v, { shouldDirty: true })}
          />
          <Switch
            label="Featured"
            checked={isFeatured}
            disabled={disabled}
            onCheckedChange={(v) => setValue('is_featured', v, { shouldDirty: true })}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Banner image</p>
          {collection ? (
            <ImageUploader
              label="Collection image"
              src={image}
              aspect="16/9"
              disabled={disabled}
              onSelect={async (f) => {
                const res = await adminCatalogApi.uploadCollectionImage(collection.id, f);
                setImage(res.image);
                void invalidate(['collections']);
                toast.success('Collection image updated.');
              }}
              onRemove={async () => {
                await adminCatalogApi.removeCollectionImage(collection.id);
                setImage(null);
                void invalidate(['collections']);
              }}
            />
          ) : (
            <ImageUploader
              label="Collection image"
              src={stagedUrl}
              aspect="16/9"
              hint="JPEG, PNG or WebP, up to 5 MB. Uploaded when you create the collection."
              onSelect={(f) => setFile(f)}
              onRemove={file ? () => setFile(null) : undefined}
            />
          )}
        </div>

        <div className="grid gap-3 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">
              Products <span className="font-normal text-text-muted">({products.length})</span>
            </h3>
            <p className="text-xs text-text-muted">Customers see them in this order.</p>
          </div>
          {canManage ? (
            <ProductPicker
              excludeIds={products.map((p) => p.id)}
              onAdd={(p) => setProducts((list) => [...list, p])}
            />
          ) : null}
          {products.length === 0 ? (
            <p className="text-sm text-text-muted">No products yet.</p>
          ) : (
            <SortableList
              label="Products in this collection"
              items={products}
              getId={(p) => p.id}
              getLabel={(p) => p.name}
              disabled={disabled}
              onReorder={setProducts}
              renderItem={(p) => (
                <div className="flex items-center gap-3">
                  <ProductImage src={p.image} alt="" aspect="1/1" className="size-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-text-muted">
                      <Money value={p.base_price} />
                      {!p.is_active ? <Badge size="sm">Archived</Badge> : null}
                    </p>
                  </div>
                  <IconButton
                    label={`Remove ${p.name} from the collection`}
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() => setProducts((list) => list.filter((x) => x.id !== p.id))}
                    icon={<Trash2 aria-hidden="true" className="size-4" />}
                  />
                </div>
              )}
            />
          )}
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <p className="mr-auto text-sm text-text-muted" role="status">
              {dirty ? 'Unsaved changes' : collection ? 'All changes saved' : ''}
            </p>
            {collection && dirty ? (
              <Button
                variant="ghost"
                onClick={() => {
                  reset();
                  setProducts(collection.products);
                  setFile(null);
                }}
              >
                Discard
              </Button>
            ) : null}
            <Button type="submit" loading={isSubmitting} disabled={Boolean(collection) && !dirty}>
              {collection ? 'Save collection' : 'Create collection'}
            </Button>
            {collection ? (
              <Button variant="ghost" className="text-danger" onClick={() => setDeleting(true)}>
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
      {collection ? (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete ${collection.name}?`}
          description="The collection is removed. The products in it are not deleted."
          confirmLabel="Delete collection"
          destructive
          onConfirm={async () => {
            await adminCatalogApi.deleteCollection(collection.id);
            await invalidate(['collections']);
            toast.success(`${collection.name} was deleted.`);
            onDeleted();
          }}
        />
      ) : null}
    </div>
  );
}
