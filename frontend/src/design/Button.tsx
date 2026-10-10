import type { ComponentProps, ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-foreground hover:bg-accent-hover',
        secondary:
          'border border-border-strong bg-surface-raised text-text hover:bg-surface-sunken',
        ghost: 'text-text hover:bg-surface-sunken',
        danger: 'bg-danger text-accent-foreground hover:brightness-110',
        link: 'h-auto rounded-none p-0 text-accent-text underline decoration-1 underline-offset-4 hover:decoration-2 active:translate-y-0',
        inverse: 'bg-surface text-text hover:bg-surface-raised',
      },
      size: {
        sm: 'h-9 rounded-md px-3.5 text-sm',
        md: 'h-11 rounded-md px-5 text-[0.9375rem]',
        lg: 'h-13 rounded-lg px-7 text-base',
        icon: 'size-11 rounded-md',
        'icon-sm': 'size-9 rounded-md',
      },
      block: { true: 'w-full', false: '' },
    },
    compoundVariants: [{ variant: 'link', size: ['sm', 'md', 'lg'], class: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ComponentProps<'button'>, Omit<VariantProps<typeof buttonVariants>, 'block'> {
  /** Render the child element (e.g. a router `Link`) with button styling instead of a `<button>`. */
  asChild?: boolean;
  /** Shows a spinner, sets `aria-busy` and blocks clicks while keeping layout stable. */
  loading?: boolean;
  /** Text announced/shown while loading (defaults to keeping the label). */
  loadingText?: ReactNode;
  block?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  loading = false,
  loadingText,
  leadingIcon,
  trailingIcon,
  disabled,
  children,
  type,
  onClick,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, block }), className);

  if (asChild) {
    return (
      <Slot.Root
        className={classes}
        aria-busy={loading || undefined}
        aria-disabled={disabled || loading || undefined}
        data-loading={loading || undefined}
        onClick={onClick}
        {...(props as object)}
      >
        {leadingIcon}
        <Slot.Slottable>{children}</Slot.Slottable>
        {trailingIcon}
      </Slot.Root>
    );
  }

  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      // Keep the button focusable while loading but ignore activations.
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {loading ? <Spinner label={null} className="size-4" /> : leadingIcon}
      {loading && loadingText !== undefined ? loadingText : children}
      {!loading ? trailingIcon : null}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonProps,
  'children' | 'leadingIcon' | 'trailingIcon' | 'size'
> {
  /** Required accessible name — icon-only buttons have no visible text. */
  label: string;
  icon: ReactNode;
  size?: 'icon' | 'icon-sm';
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'icon',
  ...props
}: IconButtonProps) {
  return (
    <Button variant={variant} size={size} aria-label={label} title={label} {...props}>
      {icon}
    </Button>
  );
}
