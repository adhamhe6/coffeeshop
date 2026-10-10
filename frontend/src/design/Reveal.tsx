import { useEffect, useRef, useState, type ComponentProps, type ElementType } from 'react';
import { cn } from '@/lib/cn';

type RevealProps<T extends ElementType> = {
  as?: T;
  /** Stagger in ms. */
  delay?: number;
} & Omit<ComponentProps<T>, 'as'>;

/**
 * Fade/slide children in once they scroll into view. Renders visible immediately when the user prefers
 * reduced motion, when IntersectionObserver is missing, or before hydration — content is never hidden for good.
 */
export function Reveal<T extends ElementType = 'div'>({
  as,
  delay = 0,
  className,
  style,
  ...props
}: RevealProps<T>) {
  const Tag: ElementType = as ?? 'div';
  const ref = useRef<HTMLElement | null>(null);
  // Reduced motion / no IntersectionObserver: start (and stay) revealed — never hide content for good.
  const [revealed, setRevealed] = useState(
    () =>
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined' ||
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || revealed) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [revealed]);

  return (
    <Tag
      ref={ref}
      className={cn('reveal', className)}
      data-revealed={revealed}
      style={{ ...(style as object), '--reveal-delay': `${delay}ms` }}
      {...props}
    />
  );
}
