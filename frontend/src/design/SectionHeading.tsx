import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SectionHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot (usually a "View all" link). */
  action?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  align?: 'start' | 'center';
  /** Visual scale; independent of the semantic level. */
  scale?: 'h1' | 'h2' | 'h3';
  inverse?: boolean;
  className?: string;
}

const scaleClass = { h1: 'text-h1', h2: 'text-h2', h3: 'text-h3' } as const;

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  as: Tag = 'h2',
  scale,
  align = 'start',
  inverse,
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-8 gap-y-4',
        align === 'center' && 'flex-col items-center text-center',
        className,
      )}
    >
      <div className={cn('max-w-2xl', align === 'center' && 'mx-auto')}>
        {eyebrow ? (
          <p className={cn('eyebrow mb-3', inverse ? 'text-accent-on-dark' : 'text-accent-text')}>
            {eyebrow}
          </p>
        ) : null}
        <Tag
          className={cn(
            scaleClass[scale ?? (Tag === 'h3' ? 'h3' : Tag)],
            inverse && 'text-text-inverse',
          )}
        >
          {title}
        </Tag>
        {description ? (
          <p
            className={cn(
              'mt-3 text-lead',
              inverse ? 'text-text-inverse-muted' : 'text-text-muted',
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
