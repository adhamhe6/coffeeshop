import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, ProductImage, toast } from '@/design';
import {
  adminCatalogApi,
  useInvalidateCatalog,
  type AdminGalleryImage,
  type AdminProduct,
} from '@/lib/api/adminCatalog';
import { aqk } from '@/lib/api/adminKeys';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { errorText } from '../../catalog-kit/errors';
import { ImageUploader } from '../../catalog-kit/ImageUploader';
import { validateImageFile } from '../../catalog-kit/imageFile';
import { SortableList } from '../../catalog-kit/SortableList';
import { SectionCard } from './SectionCard';
import { useEditor } from './editorContext';
import { useObjectUrl } from './useObjectUrl';

/** Matches the backend limit (409 `gallery_full`); the server message is shown if it ever differs. */
const GALLERY_LIMIT = 10;

function useProductImageActions(productId: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();
  const patch = (fn: (p: AdminProduct) => AdminProduct) =>
    qc.setQueryData<AdminProduct>(aqk.products.detail(productId), (old) => (old ? fn(old) : old));
  return {
    async uploadMain(file: File) {
      const { image } = await adminCatalogApi.uploadProductImage(productId, file);
      patch((p) => ({ ...p, image }));
      void invalidate(['products']);
      toast.success('Main image updated.');
    },
    async removeMain() {
      await adminCatalogApi.removeProductImage(productId);
      patch((p) => ({ ...p, image: null }));
      void invalidate(['products']);
      toast.success('Main image removed.');
    },
    async addGallery(file: File) {
      const item = await adminCatalogApi.addGalleryImage(productId, file);
      patch((p) => ({ ...p, gallery: [...p.gallery, item] }));
      void invalidate(['products']);
      toast.success('Gallery image added.');
    },
    async removeGallery(imageId: number) {
      await adminCatalogApi.deleteGalleryImage(productId, imageId);
      patch((p) => ({ ...p, gallery: p.gallery.filter((g) => g.id !== imageId) }));
      void invalidate(['products']);
      toast.success('Gallery image removed.');
    },
    async reorderGallery(next: AdminGalleryImage[]) {
      const previous = qc.getQueryData<AdminProduct>(aqk.products.detail(productId))?.gallery;
      patch((p) => ({ ...p, gallery: next }));
      try {
        await adminCatalogApi.reorderGallery(
          productId,
          next.map((g) => g.id),
        );
        void invalidate(['products']);
      } catch (e) {
        if (previous) patch((p) => ({ ...p, gallery: previous }));
        toast.error(`Could not reorder the gallery. ${errorText(e)}`);
      }
    },
    async saveAlt(imageId: number, alt: string) {
      const updated = await adminCatalogApi.updateGalleryImage(productId, imageId, alt);
      patch((p) => ({
        ...p,
        gallery: p.gallery.map((g) =>
          g.id === imageId ? { ...g, alt_text: updated.alt_text } : g,
        ),
      }));
    },
  };
}

function GalleryRow({
  image,
  index,
  disabled,
  onAlt,
  onDelete,
}: {
  image: AdminGalleryImage;
  index: number;
  disabled: boolean;
  onAlt: (alt: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [alt, setAlt] = useState(image.alt_text);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <ProductImage src={image.url} alt="" aspect="1/1" className="size-14 shrink-0" />
      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor={`alt-${image.id}`}>
          Alt text for gallery image {index + 1}
        </label>
        <Input
          id={`alt-${image.id}`}
          size="sm"
          placeholder="Describe the image (alt text)"
          value={alt}
          maxLength={160}
          disabled={disabled}
          onChange={(e) => setAlt(e.target.value)}
          onBlur={() => {
            if (alt === image.alt_text) return;
            setError(null);
            onAlt(alt).catch((e: unknown) => setError(errorText(e)));
          }}
        />
        {error ? (
          <p role="alert" className="mt-1 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <IconButton
        label={`Delete gallery image ${index + 1}`}
        size="icon-sm"
        disabled={disabled}
        onClick={onDelete}
        icon={<Trash2 aria-hidden="true" className="size-4" />}
      />
    </div>
  );
}

function StagedThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useObjectUrl(file);
  return (
    <li className="flex items-center gap-3 rounded-md border border-border p-1.5">
      <ProductImage src={url} alt="" aspect="1/1" className="size-12 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
      <IconButton
        label={`Remove ${file.name}`}
        size="icon-sm"
        onClick={onRemove}
        icon={<Trash2 aria-hidden="true" className="size-4" />}
      />
    </li>
  );
}

export function ImagesSection() {
  const { product, isNew, readOnly, staged, setStaged } = useEditor();
  const stagedMainUrl = useObjectUrl(staged.main);
  const fileInput = useRef<HTMLInputElement>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [toDelete, setToDelete] = useState<AdminGalleryImage | null>(null);
  const actions = useProductImageActions(product?.id ?? 0);

  const addGallery = async (files: FileList | null) => {
    if (!files?.length) return;
    setGalleryError(null);
    for (const file of Array.from(files)) {
      const problem = validateImageFile(file);
      if (problem) {
        setGalleryError(`${file.name}: ${problem}`);
        break;
      }
      if (isNew) {
        setStaged((s) =>
          s.gallery.length >= GALLERY_LIMIT ? s : { ...s, gallery: [...s.gallery, file] },
        );
        continue;
      }
      setGalleryBusy(true);
      try {
        await actions.addGallery(file);
      } catch (e) {
        setGalleryError(`${file.name}: ${errorText(e)}`);
        break;
      } finally {
        setGalleryBusy(false);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const galleryCount = isNew ? staged.gallery.length : (product?.gallery.length ?? 0);

  return (
    <SectionCard
      id="images"
      title="Images"
      description="The main image appears on cards and the product page. Gallery images appear on the product page only."
    >
      <div>
        <h3 className="mb-2 text-sm font-medium">Main image</h3>
        {isNew ? (
          <ImageUploader
            label="Main image"
            src={stagedMainUrl}
            disabled={readOnly}
            hint="JPEG, PNG or WebP, up to 5 MB. It is uploaded when you create the product."
            onSelect={(file) => setStaged((s) => ({ ...s, main: file }))}
            onRemove={staged.main ? () => setStaged((s) => ({ ...s, main: null })) : undefined}
          />
        ) : (
          <ImageUploader
            label="Main image"
            src={product?.image}
            disabled={readOnly}
            hint="JPEG, PNG or WebP, up to 5 MB. Uploads apply immediately."
            onSelect={actions.uploadMain}
            onRemove={actions.removeMain}
          />
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">
            Gallery{' '}
            <span className="font-normal text-text-muted">
              ({galleryCount} of {GALLERY_LIMIT})
            </span>
          </h3>
          <div>
            <input
              ref={fileInput}
              type="file"
              id="gallery-input"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => void addGallery(e.target.files)}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={readOnly || galleryBusy || galleryCount >= GALLERY_LIMIT}
              loading={galleryBusy}
              leadingIcon={<ImagePlus aria-hidden="true" className="size-4" />}
              onClick={() => fileInput.current?.click()}
            >
              Add gallery images
            </Button>
          </div>
        </div>
        {galleryError ? (
          <p role="alert" className="mb-2 text-sm font-medium text-danger">
            {galleryError}
          </p>
        ) : null}
        {isNew ? (
          staged.gallery.length ? (
            <ul className="grid gap-1.5" aria-label="Gallery images to upload">
              {staged.gallery.map((f, i) => (
                <StagedThumb
                  key={`${f.name}-${i}`}
                  file={f}
                  onRemove={() =>
                    setStaged((s) => ({ ...s, gallery: s.gallery.filter((_, j) => j !== i) }))
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No gallery images yet.</p>
          )
        ) : product && product.gallery.length ? (
          <SortableList
            label="Gallery images"
            items={product.gallery}
            getId={(g) => g.id}
            getLabel={(g) => `gallery image ${product.gallery.indexOf(g) + 1}`}
            disabled={readOnly}
            onReorder={(next) => void actions.reorderGallery(next)}
            renderItem={(g, i) => (
              <GalleryRow
                image={g}
                index={i}
                disabled={readOnly}
                onAlt={(alt) => actions.saveAlt(g.id, alt)}
                onDelete={() => setToDelete(g)}
              />
            )}
          />
        ) : (
          <p className="text-sm text-text-muted">No gallery images yet.</p>
        )}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this gallery image?"
        description="The image file is removed from the product. This cannot be undone."
        confirmLabel="Delete image"
        destructive
        onConfirm={() => (toDelete ? actions.removeGallery(toDelete.id) : undefined)}
      />
    </SectionCard>
  );
}
