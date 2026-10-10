import { useId, useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { Button, ProductImage, Spinner, type Aspect } from '@/design';
import { cn } from '@/lib/cn';
import { errorText } from './errors';
import { IMAGE_TYPES, validateImageFile } from './imageFile';

interface ImageUploaderProps {
  label: string;
  /** Current image: stored URL or a local object URL for a staged file. */
  src: string | null | undefined;
  /** Called with a file that passed the client checks. May reject: the message is shown under the picker. */
  onSelect: (file: File) => Promise<unknown> | unknown;
  /** Omit to hide the remove button. */
  onRemove?: () => Promise<unknown> | unknown;
  disabled?: boolean;
  aspect?: Aspect;
  hint?: string;
  className?: string;
}

/** File picker with preview, client-side type/size validation and server error display. */
export function ImageUploader({
  label,
  src,
  onSelect,
  onRemove,
  disabled,
  aspect = '1/1',
  hint = 'JPEG, PNG or WebP, up to 5 MB.',
  className,
}: ImageUploaderProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSelect(file);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    if (!onRemove) return;
    setError(null);
    setBusy(true);
    try {
      await onRemove();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('grid gap-2', className)}>
      <div className="flex items-start gap-3">
        <div className="relative w-28 shrink-0 sm:w-36">
          <ProductImage src={src} alt={src ? `${label} preview` : ''} aspect={aspect} />
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-surface-raised/70">
              <Spinner label={`Uploading ${label.toLowerCase()}`} className="size-5 text-text" />
            </div>
          ) : null}
        </div>
        <div className="grid gap-2">
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => void handle(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || busy}
              leadingIcon={
                src ? (
                  <Upload aria-hidden="true" className="size-4" />
                ) : (
                  <ImagePlus aria-hidden="true" className="size-4" />
                )
              }
              onClick={() => input.current?.click()}
              aria-describedby={`${inputId}-hint`}
            >
              {src ? `Replace ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}
            </Button>
            {onRemove && src ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || busy}
                leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
                onClick={() => void remove()}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <p id={`${inputId}-hint`} className="text-sm text-text-muted">
            {hint}
          </p>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
