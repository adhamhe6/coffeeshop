import { useCallback, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { LogoGlyph } from './Logo';

export type Aspect = '1/1' | '4/5' | '4/3' | '3/2' | '16/9' | '3/4' | '5/4' | '16/10' | 'auto';

export interface ProductImageProps {
  /** Root-relative URL from the API (`/media/…`), absolute URL, or null/undefined for the fallback tile. */
  src: string | null | undefined;
  /** Describe the image; pass `""` when it is decorative (adjacent text names the product). */
  alt: string;
  /** `auto` = no ratio of its own: the parent sizes the box (use with `absolute inset-0` or a fixed height). */
  aspect?: Aspect;
  /** Intrinsic size hint. Together with `aspect` it reserves space and prevents layout shift. */
  width?: number;
  height?: number;
  sizes?: string;
  srcSet?: string;
  /** Above-the-fold images: eager + high fetch priority. Everything else is lazy. */
  priority?: boolean;
  className?: string;
  imgClassName?: string;
  /** Rounded corners are on by default (8px). */
  square?: boolean;
}

const aspectStyle: Record<Exclude<Aspect, 'auto'>, string> = {
  '5/4': '5 / 4',
  '16/10': '16 / 10',
  '1/1': '1 / 1',
  '4/5': '4 / 5',
  '4/3': '4 / 3',
  '3/2': '3 / 2',
  '16/9': '16 / 9',
  '3/4': '3 / 4',
};

/**
 * Fixed-aspect image with skeleton → fade-in, lazy loading and a branded fallback tile when the source is
 * missing or fails to load. The wrapper owns the aspect ratio, so there is no layout shift in any state.
 */
export function ProductImage({
  src,
  alt,
  aspect = '1/1',
  width,
  height,
  sizes,
  srcSet,
  priority = false,
  className,
  imgClassName,
  square = false,
}: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const failed = !src || failedSrc === src;
  const loaded = Boolean(src) && loadedSrc === src;

  // Cached images can finish loading before React attaches `onLoad`.
  const imgRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (node && src && node.complete && node.naturalWidth > 0) setLoadedSrc(src);
    },
    [src],
  );

  const style: CSSProperties | undefined =
    aspect === 'auto' ? undefined : { aspectRatio: aspectStyle[aspect] };

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden bg-surface-sunken',
        !square && 'rounded-md',
        className,
      )}
      style={style}
    >
      {failed ? (
        <div
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
          data-fallback="true"
          className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,var(--color-surface-raised),var(--color-surface-sunken)_70%)] text-border-strong"
        >
          <LogoGlyph variant="mono" className="h-[34%] max-h-20 w-auto opacity-45" />
        </div>
      ) : (
        <>
          {!loaded ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-sunken)_25%,var(--color-surface-raised)_50%,var(--color-surface-sunken)_75%)] bg-[length:200%_100%] motion-reduce:animate-none"
            />
          ) : null}
          <img
            ref={imgRef}
            src={src ?? undefined}
            srcSet={srcSet}
            sizes={sizes}
            alt={alt}
            width={width}
            height={height}
            loading={priority ? 'eager' : 'lazy'}
            decoding={priority ? 'sync' : 'async'}
            fetchPriority={priority ? 'high' : 'auto'}
            onLoad={() => src && setLoadedSrc(src)}
            onError={() => src && setFailedSrc(src)}
            className={cn(
              'absolute inset-0 size-full object-cover transition-opacity duration-[var(--duration-slow)]',
              loaded ? 'opacity-100' : 'opacity-0',
              imgClassName,
            )}
          />
        </>
      )}
    </div>
  );
}
