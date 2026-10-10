import type { ComponentProps, ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-espresso/55 backdrop-blur-[2px] data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps extends Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  'title'
> {
  /** Required: dialogs must have an accessible name. */
  title: ReactNode;
  description?: ReactNode;
  /** Keep the title for assistive tech but hide it visually. */
  hideTitle?: boolean;
  hideClose?: boolean;
}

export function DialogContent({
  title,
  description,
  hideTitle,
  hideClose,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[min(90dvh,48rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-raised shadow-lg',
          'data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
          className,
        )}
        {...props}
      >
        <div className={cn('px-6 pt-6', hideTitle && 'sr-only')}>
          <DialogPrimitive.Title className="font-display text-h3 text-text">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1.5 text-sm text-text-muted">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {hideClose ? null : (
          <DialogPrimitive.Close asChild>
            <IconButton
              label="Close"
              size="icon-sm"
              icon={<X aria-hidden="true" className="size-4" />}
              className="absolute top-3 right-3"
            />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
