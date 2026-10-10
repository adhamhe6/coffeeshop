/**
 * Client-side image checks. They only exist to give instant feedback: the server re-validates by decoding the bytes
 * (type, size, dimensions) and its message is shown whenever it disagrees.
 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Mirrors the backend `MAX_IMAGE_UPLOAD_BYTES` default (5 MB); the server is the authority. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const EXTENSIONS = /\.(jpe?g|png|webp)$/i;

export function validateImageFile(file: File, maxBytes: number = IMAGE_MAX_BYTES): string | null {
  const typeOk = (IMAGE_TYPES as readonly string[]).includes(file.type);
  // Some browsers/OSes leave `type` empty; fall back to the extension (the server decodes the bytes anyway).
  if (!typeOk && !(file.type === '' && EXTENSIONS.test(file.name))) {
    return 'Unsupported file type. Choose a JPEG, PNG or WebP image.';
  }
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxBytes) {
    return `That image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). The maximum is ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  }
  return null;
}
