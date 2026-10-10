import { Toaster as Sonner, toast } from 'sonner';

/**
 * Mount once (AppProviders does). Trigger with `toast.success('Added to cart')`.
 * Sonner provides an `aria-live` region and pauses on hover/focus.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      offset={{ bottom: 16, right: 16 }}
      mobileOffset={{ bottom: 12, left: 12, right: 12 }}
      toastOptions={{
        classNames: {
          toast:
            '!rounded-md !border !border-border !bg-surface-raised !font-sans !text-sm !text-text !shadow-md',
          description: '!text-text-muted',
          success: '[&_[data-icon]]:!text-success',
          error: '[&_[data-icon]]:!text-danger',
          closeButton: '!border-border !bg-surface-raised !text-text',
        },
      }}
    />
  );
}

export { toast };
