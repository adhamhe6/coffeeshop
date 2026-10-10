import { useState } from 'react';
import { cn } from '@/lib/cn';
import { ProductImage } from '@/design';

export interface GalleryImage {
  url: string | null;
  alt: string;
}

/** Main image + thumbnails (only when there is more than one picture). Square, crisp, no zoom. */
export function ProductGallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  const list = images.length ? images : [{ url: null, alt: name }];
  const current = list[Math.min(index, list.length - 1)] as GalleryImage;
  return (
    <div className="grid gap-3">
      <ProductImage
        src={current.url}
        alt={current.alt || name}
        aspect="1/1"
        priority
        sizes="(min-width: 1024px) 50vw, 100vw"
        className="w-full rounded-lg"
      />
      {list.length > 1 ? (
        <ul aria-label={`${name} pictures`} className="grid grid-cols-5 gap-2.5">
          {list.map((img, i) => (
            <li key={`${img.url}-${i}`}>
              <button
                type="button"
                aria-label={`Show picture ${i + 1} of ${list.length}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  'block w-full overflow-hidden rounded-md border-2 transition-colors',
                  i === index ? 'border-accent' : 'border-transparent hover:border-border-strong',
                )}
              >
                <ProductImage src={img.url} alt="" aspect="1/1" square sizes="12vw" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
