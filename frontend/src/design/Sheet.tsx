import type { ComponentProps, ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';
import { DialogOverlay } from './Dialog';

/** Edge-anchored panel (mobile navigation, cart, filters). Same a11y behaviour as Dialog. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const sheetVariants = cva(
  'fixed z-50 flex flex-col bg-surface-raised shadow-lg outline-none data-[state=closed]:duration-200',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-dvh w-[min(26rem,100vw)] border-l border-border data-[state=closed]:animate-sheet-out-right data-[state=open]:animate-sheet-in-right',
        left: 'inset-y-0 left-0 h-dvh w-[min(24rem,88vw)] border-r border-border data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left',
        top: 'inset-x-0 top-0 max-h-[90dvh] border-b border-border data-[state=closed]:animate-sheet-out-top data-[state=open]:animate-sheet-in-top',
        bottom:
          'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-lg border-t border-border data-[state=closed]:animate-sheet-out-bottom data-[state=open]:animate-sheet-in-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export interface SheetContentProps
  extends
    Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'>,
    VariantProps<typeof sheetVariants> {
  title: ReactNode;
  description?: ReactNode;
  hideTitle?: boolean;
  hideClose?: boolean;
}

export function SheetContent({
  side,
  title,
  description,
  hideTitle,
  hideClose,
  className,
  children,
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(sheetVariants({ side }), className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <DialogPrimitive.Title
            className={cn('font-display text-h4 font-semibold', hideTitle && 'sr-only')}
          >
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="sr-only">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <IconButton
                label="Close"
                size="icon-sm"
                icon={<X aria-hidden="true" className="size-4" />}
              />
            </DialogPrimitive.Close>
          )}
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
