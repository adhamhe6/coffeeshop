import { useState } from 'react';
import { Archive } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogFooter } from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { adminCatalogApi } from '@/lib/api/adminCatalog';
import { isApiError } from '@/lib/api/errors';
import { errorText } from '../../catalog-kit/errors';

interface DeleteProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: { id: number; name: string; is_active: boolean };
  onDeleted: () => void;
  onArchived: () => void;
}

/**
 * Permanent delete. The API refuses (409 has_orders) when the product is on any order; in that case the dialog
 * explains why and offers Archive, which hides it from customers but keeps order history.
 */
export function DeleteProductDialog({
  open,
  onOpenChange,
  product,
  onDeleted,
  onArchived,
}: DeleteProductDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hasOrders: boolean } | null>(null);

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) setError(null);
    onOpenChange(next);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminCatalogApi.deleteProduct(product.id);
      onDeleted();
    } catch (e) {
      setError({
        message: errorText(e),
        hasOrders: isApiError(e) && e.status === 409 && e.code === 'has_orders',
      });
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    try {
      await adminCatalogApi.archiveProduct(product.id);
      onArchived();
      setError(null);
    } catch (e) {
      setError({ message: errorText(e), hasOrders: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={`Delete ${product.name}?`}
        description="Deleting removes the product, its images and its place in collections for good. It cannot be undone."
      >
        {error ? (
          <div className="grid gap-3">
            <FormAlert>{error.message}</FormAlert>
            {error.hasOrders ? (
              <p className="text-sm text-text-muted">
                Products that have been ordered cannot be deleted because order history must stay
                accurate. Archive it instead: customers will no longer see or order it, and you can
                restore it at any time.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            If you only want it off the menu for now, archive it instead; that is reversible.
          </p>
        )}
        <DialogFooter className="sticky -bottom-5 -mx-6 mt-5 -mb-5 bg-surface-raised">
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          {error?.hasOrders && product.is_active ? (
            <Button
              onClick={() => void archive()}
              loading={busy}
              leadingIcon={<Archive aria-hidden="true" className="size-4" />}
            >
              Archive instead
            </Button>
          ) : null}
          {!error?.hasOrders ? (
            <Button variant="danger" onClick={() => void remove()} loading={busy}>
              Delete product
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
