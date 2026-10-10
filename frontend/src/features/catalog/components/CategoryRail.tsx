import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { Container } from '@/design';

export interface RailItem {
  slug: string;
  name: string;
  count?: number;
}

interface CategoryRailProps {
  categories: RailItem[];
  /** Active category slug (`undefined` = "All"). */
  active?: string;
  /** Query string (`?type=BEANS`) carried over when switching category. */
  search?: string;
  isLoading?: boolean;
}

/**
 * Sticky category tabs: one horizontally scrollable row (swipe on phones). The active tab is scrolled into view,
 * edges fade to hint at overflow, and each tab is a real link (`/menu/:category`).
 */
export function CategoryRail({ categories, active, search = '', isLoading }: CategoryRailProps) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = activeRef.current;
    const scroller = el?.parentElement?.parentElement;
    if (!el || !scroller) return;
    const target = el.offsetLeft - scroller.clientWidth / 2 + el.clientWidth / 2;
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ left: Math.max(0, target) });
  }, [active, categories.length]);

  const tab = (isActive: boolean) =>
    cn(
      'inline-flex h-11 items-center gap-1.5 rounded-pill border px-4 text-[0.9375rem] font-medium whitespace-nowrap transition-colors',
      isActive
        ? 'border-espresso bg-espresso text-cream'
        : 'border-border-strong bg-surface-raised text-text hover:border-text',
    );

  return (
    <div className="sticky top-[var(--header-h)] z-30 border-b border-border bg-surface/95 backdrop-blur-md">
      <Container size="wide">
        <nav aria-label="Menu categories" className="relative">
          <ul className="flex [scroll-snap-type:x_proximity] scrollbar-none gap-2 overflow-x-auto py-2.5">
            <li className="shrink-0 [scroll-snap-align:start]">
              <Link
                to={`/menu${search}`}
                ref={!active ? activeRef : undefined}
                aria-current={!active ? 'page' : undefined}
                className={tab(!active)}
              >
                All
              </Link>
            </li>
            {isLoading
              ? [0, 1, 2, 3, 4].map((i) => (
                  <li key={i} aria-hidden="true" className="shrink-0">
                    <span className="block h-11 w-28 animate-shimmer rounded-pill bg-surface-sunken motion-reduce:animate-none" />
                  </li>
                ))
              : categories.map((c) => {
                  const isActive = c.slug === active;
                  return (
                    <li key={c.slug} className="shrink-0 [scroll-snap-align:start]">
                      <Link
                        to={`/menu/${c.slug}${search}`}
                        ref={isActive ? activeRef : undefined}
                        aria-current={isActive ? 'page' : undefined}
                        className={tab(isActive)}
                      >
                        {c.name}
                        {c.count !== undefined ? (
                          <span
                            className={cn(
                              'text-xs tabular-nums',
                              isActive ? 'text-cream/80' : 'text-text-muted',
                            )}
                          >
                            {c.count}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
          </ul>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent lg:hidden"
          />
        </nav>
      </Container>
    </div>
  );
}
