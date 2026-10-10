import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Controls rendered inside a `<Field>` call this to pick up the generated `id`,
 * `aria-describedby`, `aria-invalid` and `required`. Returns `null` outside a Field.
 */
export function useFieldControl(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** Help text shown under the control. */
  hint?: ReactNode;
  /** Error message; its presence marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  className?: string;
  /** Optional element aligned to the right of the label (e.g. "Forgot password?"). */
  labelAction?: ReactNode;
  /** `inverse` for fields placed on espresso (dark) surfaces. */
  tone?: 'default' | 'inverse';
  children: ReactNode;
}

/**
 * Label + control + hint + error wiring.
 * `<Field label="Email" error={errors.email?.message}><Input type="email" {...register('email')} /></Field>`
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  hideLabel = false,
  labelAction,
  tone = 'default',
  className,
  children,
}: FieldProps) {
  const inverse = tone === 'inverse';
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required, disabled }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
          <label
            htmlFor={id}
            className={cn('text-sm font-medium', inverse ? 'text-text-inverse' : 'text-text')}
          >
            {label}
            {required ? (
              <span
                aria-hidden="true"
                className={cn('ml-0.5', inverse ? 'text-danger-on-dark' : 'text-danger')}
              >
                *
              </span>
            ) : null}
          </label>
          {labelAction ? <span className="text-sm">{labelAction}</span> : null}
        </div>
        {children}
        {hint ? (
          <p
            id={hintId}
            className={cn('text-sm', inverse ? 'text-text-inverse-muted' : 'text-text-muted')}
          >
            {hint}
          </p>
        ) : null}
        {error ? (
          <p
            id={errorId}
            role="alert"
            className={cn(
              'flex items-start gap-1.5 text-sm font-medium',
              inverse ? 'text-danger-on-dark' : 'text-danger',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
              fill="currentColor"
            >
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 3.5h1.5v4h-1.5V5Zm.75 6.9a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
            </svg>
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export const controlBase = [
  'w-full border bg-surface-raised text-text placeholder:text-text-muted/80',
  'rounded-md transition-[border-color,box-shadow] duration-[var(--duration-fast)]',
  'hover:border-text-muted focus-visible:border-text focus-visible:outline-2 focus-visible:outline-offset-1',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:outline-danger',
].join(' ');
export const controlBorder = 'border-border-strong';
