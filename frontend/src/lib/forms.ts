import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { isApiError } from './api/errors';

/**
 * Map a backend validation error onto react-hook-form. Known field names get inline messages; everything else
 * (non-field errors, other codes, network failures) is returned as a single message for a form-level alert.
 *
 *   const formError = applyApiErrors(err, setError, ['email', 'password']);
 *   setServerError(formError);
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: ReadonlyArray<Path<T>>,
): string | null {
  if (!isApiError(error)) return 'Something went wrong. Please try again.';
  let unmapped = false;
  for (const [field, messages] of Object.entries(error.fields)) {
    if ((knownFields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { type: 'server', message: messages.join(' ') });
    } else {
      unmapped = true;
    }
  }
  const mapped = Object.keys(error.fields).some((f) =>
    (knownFields as readonly string[]).includes(f),
  );
  if (error.code === 'validation_error' && mapped && !unmapped) return null;
  const nonField = error.fields.non_field_errors?.[0] ?? error.fields.detail?.[0];
  return nonField ?? error.message;
}
