import { describeError, isApiError } from '@/lib/api/errors';

/** One readable sentence for a failed request (toast or inline alert). */
export function errorText(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 403) return error.message || 'Your role is not allowed to do this.';
    if (error.status === 404) return 'That item no longer exists, or you do not have access to it.';
    const first = Object.values(error.fields)[0]?.[0];
    if (error.code === 'validation_error' && first) return first;
    return error.message;
  }
  return describeError(error).message;
}

/** First field message for `field`, if the server sent one. */
export function fieldError(error: unknown, field: string): string | undefined {
  return isApiError(error) ? error.fields[field]?.[0] : undefined;
}
