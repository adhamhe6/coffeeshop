import type { ComponentType, SVGProps } from 'react';
import {
  Ban,
  Bike,
  Check,
  CheckCheck,
  ClipboardList,
  CookingPot,
  PackageCheck,
  type LucideIcon,
} from 'lucide-react';
import type { TimelineStep } from '@/lib/api/orders';
import { cn } from '@/lib/cn';
import { formatTime } from '../format';

const ICONS: Record<string, LucideIcon> = {
  PENDING: ClipboardList,
  CONFIRMED: Check,
  PREPARING: CookingPot,
  READY_FOR_PICKUP: PackageCheck,
  OUT_FOR_DELIVERY: Bike,
  COMPLETED: CheckCheck,
  CANCELLED: Ban,
};

const STATE_WORD: Record<TimelineStep['state'], string> = {
  done: 'done',
  current: 'current step',
  upcoming: 'upcoming',
  cancelled: 'cancelled',
};

/**
 * Server `timeline` as an accessible ordered list: every step has an icon AND a label, the current step carries
 * `aria-current="step"` and a text suffix, so progress is never conveyed by colour alone. Pickup and delivery
 * orders get different steps because the server sends different timelines. No times are invented: a step only
 * shows a time when the server recorded one.
 */
export function OrderTimeline({ steps, timeZone }: { steps: TimelineStep[]; timeZone?: string }) {
  return (
    <ol
      aria-label="Order progress"
      className="grid gap-0 md:auto-cols-fr md:grid-flow-col"
      data-testid="timeline"
    >
      {steps.map((step, index) => {
        const Icon: ComponentType<SVGProps<SVGSVGElement>> = ICONS[step.status] ?? ClipboardList;
        const done = step.state === 'done';
        const current = step.state === 'current';
        const cancelled = step.state === 'cancelled';
        const last = index === steps.length - 1;
        return (
          <li
            key={`${step.status}-${index}`}
            aria-current={current ? 'step' : undefined}
            data-state={step.state}
            className="relative flex gap-4 pb-6 last:pb-0 md:flex-col md:items-center md:gap-3 md:pb-0 md:text-center"
          >
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-11 left-[1.3125rem] h-[calc(100%-2.75rem)] w-0.5 md:top-[1.3125rem] md:left-[calc(50%+1.75rem)] md:h-0.5 md:w-[calc(100%-3.5rem)]',
                  done ? 'bg-success' : 'bg-border',
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 flex size-[2.625rem] shrink-0 items-center justify-center rounded-full border-2',
                done && 'border-success bg-success text-white',
                current && 'border-accent bg-accent-soft text-accent-text ring-4 ring-accent/15',
                cancelled && 'border-danger bg-danger-bg text-danger',
                step.state === 'upcoming' &&
                  'border-border-strong bg-surface-raised text-text-muted',
              )}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 pt-1.5 md:pt-0">
              <p
                className={cn(
                  'font-medium',
                  step.state === 'upcoming' ? 'text-text-muted' : 'text-text',
                  current && 'font-semibold',
                )}
              >
                {step.label}
                <span className="sr-only"> ({STATE_WORD[step.state]})</span>
              </p>
              {step.at && step.state !== 'upcoming' ? (
                <p className="text-sm text-text-muted">{formatTime(step.at, timeZone)}</p>
              ) : current ? (
                <p className="text-sm font-medium text-accent-text" aria-hidden="true">
                  In progress
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
