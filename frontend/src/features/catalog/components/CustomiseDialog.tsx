import type { RefObject } from 'react';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import type { ProductSummary } from '@/lib/api/types';
import {
  Dialog,
  DialogContent,
  ErrorState,
  Money,
  ProductImage,
  Sheet,
  SheetContent,
  Skeleton,
} from '@/design';
import { useProductDetail } from '../api';
import { useSelectedBranch } from '../useSelectedBranch';
import { Customiser } from './Customiser';

interface CustomiseDialogProps {
  product: Pick<ProductSummary, 'slug' | 'name' | 'image' | 'short_description' | 'base_price'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element that opened the dialog; focus returns to it on close (it is not a Radix trigger). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

function Body({
  product,
  onClose,
}: {
  product: CustomiseDialogProps['product'];
  onClose: () => void;
}) {
  const { branchSlug, isReady } = useSelectedBranch();
  const detail = useProductDetail(product.slug, branchSlug, isReady);
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-4">
        <ProductImage src={product.image} alt="" aspect="1/1" className="size-20 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm text-text-muted">
            From <Money value={product.base_price} />
          </p>
          {product.short_description ? (
            <p className="line-clamp-3 text-sm text-text-muted">{product.short_description}</p>
          ) : null}
        </div>
      </div>
      {detail.isError ? (
        <ErrorState
          error={detail.error}
          onRetry={() => void detail.refetch()}
          retrying={detail.isFetching}
          className="py-6"
        />
      ) : detail.data ? (
        <Customiser product={detail.data} layout="dialog" onDone={onClose} />
      ) : (
        <div className="grid gap-4" aria-busy="true" aria-label="Loading options">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-12" />
        </div>
      )}
    </div>
  );
}

/** Customise-and-add without leaving the list: a dialog on desktop, a bottom sheet on phones. */
export function CustomiseDialog({
  product,
  open,
  onOpenChange,
  returnFocusTo,
}: CustomiseDialogProps) {
  const isDesktop = useIsDesktop();
  const close = () => onOpenChange(false);
  const title = `Customise ${product.name}`;
  const restoreFocus = (e: Event) => {
    if (!returnFocusTo?.current) return;
    e.preventDefault();
    returnFocusTo.current.focus();
  };
  if (isDesktop)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={title} className="max-w-xl" onCloseAutoFocus={restoreFocus}>
          <Body product={product} onClose={close} />
        </DialogContent>
      </Dialog>
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        title={title}
        className="max-h-[92dvh]"
        onCloseAutoFocus={restoreFocus}
      >
        <div className="p-5">
          <Body product={product} onClose={close} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
