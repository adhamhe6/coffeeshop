import { useEffect, useState } from 'react';

/**
 * Preview URL (data URL) for a locally chosen file, `null` until it has been read or when there is no file.
 * A data URL needs no revoking, so it is safe under StrictMode's double effects.
 */
export function useObjectUrl(file: File | null | undefined): string | null {
  const [entry, setEntry] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelled && typeof reader.result === 'string') setEntry({ file, url: reader.result });
    };
    reader.readAsDataURL(file);
    return () => {
      cancelled = true;
    };
  }, [file]);
  return file && entry?.file === file ? entry.url : null;
}
