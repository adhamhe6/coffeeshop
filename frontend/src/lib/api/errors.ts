/** Shape of the backend error envelope: `{ error: { code, message, fields?, request_id } }`. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: Record<string, unknown>;
    request_id?: string;
    retry_after?: number;
    [extra: string]: unknown;
  };
}

/** Per-field messages, normalised from DRF's `string | string[] | nested` shapes. */
export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors;
  readonly requestId: string | undefined;
  /** Any extra keys the backend added to the envelope (e.g. `items` for out_of_stock). */
  readonly extra: Record<string, unknown>;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    fields?: FieldErrors;
    requestId?: string;
    extra?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fields = init.fields ?? {};
    this.requestId = init.requestId;
    this.extra = init.extra ?? {};
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  get isNotFound() {
    return this.status === 404;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

function flattenField(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenField);
  if (value && typeof value === 'object') return Object.values(value).flatMap(flattenField);
  return [];
}

export function normaliseFields(fields: unknown): FieldErrors {
  if (!fields || typeof fields !== 'object') return {};
  const out: FieldErrors = {};
  for (const [key, value] of Object.entries(fields)) {
    const messages = flattenField(value);
    if (messages.length) out[key] = messages;
  }
  return out;
}

/** Turn any thrown value into something displayable. */
export function describeError(error: unknown): {
  title: string;
  message: string;
  requestId?: string;
} {
  if (isApiError(error)) {
    if (error.isNetwork) {
      return { title: 'You appear to be offline', message: 'Check your connection and try again.' };
    }
    const title =
      error.status === 404
        ? 'Not found'
        : error.status === 403
          ? 'Not allowed'
          : error.status >= 500
            ? 'Something went wrong'
            : 'Request failed';
    return { title, message: error.message, requestId: error.requestId };
  }
  return {
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
  };
}
