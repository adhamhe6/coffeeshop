import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

interface ContainerProps extends ComponentProps<'div'> {
  size?: 'narrow' | 'default' | 'wide' | 'full';
}

const sizes = {
  narrow: 'max-w-3xl',
  default: 'max-w-[80rem]',
  wide: 'max-w-[92rem]',
  full: 'max-w-none',
} as const;

/** Centered page column with responsive gutters (16px on phones, 32px on desktop). */
export function Container({ className, size = 'default', ...props }: ContainerProps) {
  return (
    <div className={cn('mx-auto w-full px-[var(--gutter)]', sizes[size], className)} {...props} />
  );
}
