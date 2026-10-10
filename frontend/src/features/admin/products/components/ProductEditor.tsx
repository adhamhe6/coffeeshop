import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  CircleCheckBig,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import {
  adminCatalogApi,
  useInvalidateCatalog,
  type AdminCategory,
  type AdminCollection,
  type AdminModifierGroup,
  type AdminProduct,
  type AdminTag,
} from '@/lib/api/adminCatalog';
import { aqk } from '@/lib/api/adminKeys';
import { isApiError } from '@/lib/api/errors';
import { applyApiErrors } from '@/lib/forms';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { errorText } from '../../catalog-kit/errors';
import { PageHeader } from '../../catalog-kit/PageHeader';
import {
  changedPayload,
  EMPTY_PRODUCT,
  FIELD_SECTION,
  fromProduct,
  PRODUCT_SERVER_FIELDS,
  productSchema,
  toPayload,
  type ProductFormValues,
} from '../productForm';
import { useUnsavedGuard } from '../useUnsavedGuard';
import { AvailabilitySection } from './AvailabilitySection';
import {
  BasicsSection,
  DetailsSection,
  MerchandisingSection,
  PricingSection,
} from './BasicSections';
import { DeleteProductDialog } from './DeleteProductDialog';
import { ImagesSection } from './ImagesSection';
import { OptionsSection } from './OptionsSection';
import { ProductPreview } from './ProductPreview';
import { ProductStatus } from './ProductStatus';
import { EditorContext, type StagedFiles } from './editorContext';

const SECTIONS = [
  ['basics', 'Basics'],
  ['pricing', 'Pricing'],
  ['images', 'Images'],
  ['options', 'Options'],
  ['merchandising', 'Merchandising'],
  ['details', 'Details'],
  ['availability', 'Availability'],
] as const;

interface ProductEditorProps {
  product?: AdminProduct;
  collectionIds: number[];
  categories: AdminCategory[];
  groups: AdminModifierGroup[];
  collections: AdminCollection[];
  tags: AdminTag[];
  readOnly: boolean;
  canViewInventory: boolean;
}

const NO_FILES: StagedFiles = { main: null, gallery: [] };

function scrollToSection(id: string) {
  document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function ProductEditor({
  product,
  collectionIds,
  categories,
  groups,
  collections,
  tags,
  readOnly,
  canViewInventory,
}: ProductEditorProps) {
  const isNew = !product;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();

  // The values the form was last reset to (what "unchanged" means for the PATCH diff and for Discard).
  const [baseline, setBaseline] = useState<ProductFormValues>(() =>
    product ? fromProduct(product, collectionIds) : EMPTY_PRODUCT,
  );
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: baseline,
    mode: 'onTouched',
  });
  const {
    formState: { isDirty, isSubmitting, errors },
  } = form;

  const [staged, setStagedState] = useState<StagedFiles>(NO_FILES);
  const setStaged = (fn: (prev: StagedFiles) => StagedFiles) => setStagedState(fn);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Set after a successful create/delete: navigation then happens in an effect, once the guard has been released.
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  const dirty = (isDirty || staged.main !== null || staged.gallery.length > 0) && leaveTo === null;
  const blocker = useUnsavedGuard(dirty);
  useEffect(() => {
    if (leaveTo) navigate(leaveTo, { replace: true });
  }, [leaveTo, navigate]);

  const ctx = {
    product,
    isNew,
    readOnly,
    categories,
    groups,
    collections,
    tags,
    staged,
    setStaged,
    canViewInventory,
  };

  const errorSections = useMemo(() => {
    const out = new Set<string>();
    for (const key of Object.keys(errors)) {
      const section = FIELD_SECTION[key];
      if (section) out.add(section);
    }
    return out;
  }, [errors]);
  const errorCount = Object.keys(errors).length;

  const handleSaveError = (e: unknown) => {
    const message = applyApiErrors(e, form.setError, PRODUCT_SERVER_FIELDS);
    setFormError(message);
    if (isApiError(e)) {
      const first = Object.keys(e.fields).find((f) =>
        (PRODUCT_SERVER_FIELDS as readonly string[]).includes(f),
      );
      if (first) {
        setTab('edit');
        const section = FIELD_SECTION[first];
        if (section) setTimeout(() => scrollToSection(section), 0);
        setTimeout(() => form.setFocus(first as keyof ProductFormValues), 50);
      }
    }
  };

  const syncCollections = async (productId: number, current: number[], wanted: number[]) => {
    const applied = new Set(current);
    const problems: string[] = [];
    for (const id of wanted.filter((x) => !applied.has(x))) {
      try {
        await adminCatalogApi.addCollectionProduct(id, productId);
        applied.add(id);
      } catch (e) {
        problems.push(
          `${collections.find((c) => c.id === id)?.name ?? 'Collection'}: ${errorText(e)}`,
        );
      }
    }
    for (const id of current.filter((x) => !wanted.includes(x))) {
      try {
        await adminCatalogApi.removeCollectionProduct(id, productId);
        applied.delete(id);
      } catch (e) {
        problems.push(
          `${collections.find((c) => c.id === id)?.name ?? 'Collection'}: ${errorText(e)}`,
        );
      }
    }
    return { applied: [...applied], problems };
  };

  const create = async (values: ProductFormValues) => {
    const created = await adminCatalogApi.createProduct(toPayload(values));
    const warnings: string[] = [];
    if (staged.main) {
      try {
        await adminCatalogApi.uploadProductImage(created.id, staged.main);
      } catch (e) {
        warnings.push(`Main image was not uploaded: ${errorText(e)}`);
      }
    }
    for (const file of staged.gallery) {
      try {
        await adminCatalogApi.addGalleryImage(created.id, file);
      } catch (e) {
        warnings.push(`${file.name} was not uploaded: ${errorText(e)}`);
      }
    }
    const { problems } = await syncCollections(created.id, [], values.collection_ids);
    warnings.push(...problems.map((p) => `Collection ${p}`));
    await invalidate(['products', 'collections', 'tags']);
    toast.success(`${created.name} was created.`);
    warnings.forEach((w) => toast.warning(w, { duration: 10_000 }));
    setStagedState(NO_FILES);
    form.reset(values);
    setLeaveTo(`/admin/products/${created.id}`);
  };

  const update = async (current: AdminProduct, values: ProductFormValues) => {
    const diff = changedPayload(toPayload(values), toPayload(baseline));
    let saved = current;
    if (Object.keys(diff).length) {
      saved = await adminCatalogApi.updateProduct(current.id, diff);
      qc.setQueryData(aqk.products.detail(current.id), saved);
    }
    const { applied, problems } = await syncCollections(
      current.id,
      baseline.collection_ids,
      values.collection_ids,
    );
    const next = fromProduct(saved, applied);
    setBaseline(next);
    form.reset(next);
    if (problems.length) {
      form.setValue('collection_ids', values.collection_ids, { shouldDirty: true });
      setFormError(
        `The product was saved, but its collections could not be updated. ${problems.join(' ')}`,
      );
    }
    await invalidate(['products', 'collections', 'tags']);
    toast.success(`${saved.name} was saved.`);
  };

  const submit = form.handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        if (product) await update(product, values);
        else await create(values);
      } catch (e) {
        handleSaveError(e);
      }
    },
    () => {
      setFormError(null);
      setTab('edit');
    },
  );

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    if (readOnly) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const discard = () => {
    form.reset(baseline);
    setStagedState(NO_FILES);
    setFormError(null);
  };

  const applyActive = (saved: AdminProduct) => {
    qc.setQueryData(aqk.products.detail(saved.id), saved);
    setBaseline((b) => ({ ...b, is_active: saved.is_active }));
    form.resetField('is_active', { defaultValue: saved.is_active });
    form.setValue('is_active', saved.is_active);
    void invalidate(['products']);
  };

  const archive = async () => {
    if (!product) return;
    const saved = await adminCatalogApi.archiveProduct(product.id);
    applyActive(saved);
    toast.success(`${saved.name} was archived. Customers can no longer see it.`);
  };
  const restore = async () => {
    if (!product) return;
    try {
      const saved = await adminCatalogApi.unarchiveProduct(product.id);
      applyActive(saved);
      toast.success(`${saved.name} is active again.`);
    } catch (e) {
      toast.error(`Could not restore the product. ${errorText(e)}`);
    }
  };

  return (
    <FormProvider {...form}>
      <EditorContext.Provider value={ctx}>
        <form
          onSubmit={(e) => void submit(e)}
          noValidate
          aria-label={isNew ? 'New product' : 'Edit product'}
        >
          <PageHeader
            title={product?.name ?? 'New product'}
            description={
              product ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <ProductStatus isActive={product.is_active} isSoldOut={product.is_sold_out} />
                  <span>
                    <span className="font-mono">{product.sku}</span> · {product.category_name}
                    {product.is_demo ? ' · Demo content' : ''}
                  </span>
                </span>
              ) : (
                'Fill in the basics, then add images and options. You can change everything later.'
              )
            }
            actions={
              product ? (
                <>
                  {product.is_active ? (
                    <Button asChild variant="secondary" size="sm">
                      <a href={`/p/${product.slug}`} target="_blank" rel="noopener noreferrer">
                        View on storefront
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    </Button>
                  ) : null}
                  {!readOnly ? (
                    <>
                      {product.is_active ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          leadingIcon={<Archive aria-hidden="true" className="size-4" />}
                          onClick={() => setArchiveOpen(true)}
                        >
                          Archive
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          leadingIcon={<ArchiveRestore aria-hidden="true" className="size-4" />}
                          onClick={() => void restore()}
                        >
                          Restore
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
                        onClick={() => setDeleteOpen(true)}
                      >
                        Delete…
                      </Button>
                    </>
                  ) : null}
                </>
              ) : null
            }
          />

          {readOnly ? (
            <p
              className="mb-4 rounded-md border border-border bg-surface-sunken p-3 text-sm"
              role="note"
            >
              You can view this product but your role cannot change it.
            </p>
          ) : null}

          <Tabs value={tab} onValueChange={(v) => setTab(v as 'edit' | 'preview')}>
            <TabsList aria-label="Editor view">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="edit" forceMount className="data-[state=inactive]:hidden">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[10rem_minmax(0,1fr)]">
                <nav
                  aria-label="Sections"
                  className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:grid lg:content-start lg:self-start"
                >
                  {SECTIONS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => scrollToSection(id)}
                      className="flex h-9 shrink-0 items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-medium text-text-muted hover:bg-surface-sunken hover:text-text"
                    >
                      {label}
                      {errorSections.has(id) ? (
                        <>
                          <CircleAlert aria-hidden="true" className="size-4 text-danger" />
                          <span className="sr-only">has errors</span>
                        </>
                      ) : null}
                    </button>
                  ))}
                </nav>
                <div className="grid max-w-4xl min-w-0 content-start gap-5">
                  <BasicsSection />
                  <PricingSection />
                  <ImagesSection />
                  <OptionsSection />
                  <MerchandisingSection />
                  <DetailsSection />
                  <AvailabilitySection />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="preview">
              <ProductPreview />
            </TabsContent>
          </Tabs>

          {!readOnly ? (
            <div className="sticky bottom-0 z-20 -mx-4 mt-6 -mb-4 border-t border-border bg-surface-raised/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:-mb-6 lg:px-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={isSubmitting} disabled={!isNew && !dirty}>
                  {isNew ? 'Create product' : 'Save changes'}
                </Button>
                {isNew ? (
                  <Button asChild variant="ghost">
                    <Link to="/admin/products">Cancel</Link>
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={discard} disabled={!dirty || isSubmitting}>
                    Discard changes
                  </Button>
                )}
                <div
                  className="order-first grid basis-full gap-1 text-sm sm:order-last sm:ml-auto sm:basis-auto"
                  role="status"
                  aria-live="polite"
                >
                  {formError ? <FormAlert>{formError}</FormAlert> : null}
                  {!formError && errorCount > 0 ? (
                    <span className="flex items-center gap-1.5 font-medium text-danger">
                      <CircleAlert aria-hidden="true" className="size-4" />
                      {errorCount} field{errorCount === 1 ? '' : 's'} need attention
                    </span>
                  ) : !formError ? (
                    <span className="flex items-center gap-1.5 text-text-muted">
                      {isSubmitting ? (
                        'Saving…'
                      ) : dirty ? (
                        <>
                          <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
                          Unsaved changes
                        </>
                      ) : isNew ? (
                        'Not saved yet'
                      ) : (
                        <>
                          <CircleCheckBig aria-hidden="true" className="size-4 text-success" />
                          All changes saved
                        </>
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </form>

        {product ? (
          <>
            <ConfirmDialog
              open={archiveOpen}
              onOpenChange={setArchiveOpen}
              title={`Archive ${product.name}?`}
              description="It disappears from the storefront and cannot be ordered. Order history is kept, and you can restore it any time."
              confirmLabel="Archive product"
              onConfirm={archive}
            />
            <DeleteProductDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              product={product}
              onDeleted={() => {
                void invalidate(['products', 'collections']);
                toast.success(`${product.name} was deleted.`);
                setLeaveTo('/admin/products');
              }}
              onArchived={() => {
                void qc.invalidateQueries({ queryKey: aqk.products.detail(product.id) });
                void invalidate(['products']);
                toast.success(`${product.name} was archived instead.`);
                setDeleteOpen(false);
              }}
            />
          </>
        ) : null}

        <Dialog open={blocker.state === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
          <DialogContent
            title="Leave without saving?"
            description="You have unsaved changes to this product. If you leave now they will be lost."
          >
            <DialogFooter className="sticky -bottom-5 -mx-6 mt-2 -mb-5 bg-surface-raised">
              <Button variant="secondary" onClick={() => blocker.reset?.()}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={() => blocker.proceed?.()}>
                Discard and leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </EditorContext.Provider>
    </FormProvider>
  );
}
