import { useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { Clock, Zap } from 'lucide-react';
import {
  RadioCard,
  RadioGroup,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design';
import { useSlots } from '@/lib/api/checkout';
import type { OrderType } from '@/lib/api/orders';
import { cn } from '@/lib/cn';

export type Timing = { mode: 'asap' } | { mode: 'scheduled'; startsAt: string | null };

const DAYS_AHEAD = 7;

function timeIn(zone: string | undefined, iso: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return format(new Date(iso), 'p');
  }
}

function dayLabel(date: string, index: number) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  return format(parseISO(date), 'EEE d');
}

/** ASAP or a scheduled slot, grouped by day. All times come from the server in the branch's timezone. */
export function TimeStep({
  branchSlug,
  orderType,
  value,
  onChange,
}: {
  branchSlug: string | null;
  orderType: OrderType;
  value: Timing;
  onChange: (timing: Timing) => void;
}) {
  const today = useSlots(branchSlug ?? undefined, orderType);
  const baseDate = today.data?.date;
  const days = useMemo(
    () =>
      baseDate
        ? Array.from({ length: DAYS_AHEAD }, (_, i) =>
            format(addDays(parseISO(baseDate), i), 'yyyy-MM-dd'),
          )
        : [],
    [baseDate],
  );
  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? baseDate;
  const slots = useSlots(
    branchSlug ?? undefined,
    orderType,
    activeDay && activeDay !== baseDate ? activeDay : undefined,
  );

  // ASAP can be unavailable (closed, paused): move to scheduling instead of leaving a disabled choice selected.
  const asapUnavailable = today.data ? !today.data.asap_available : false;
  useEffect(() => {
    if (asapUnavailable && value.mode === 'asap') onChange({ mode: 'scheduled', startsAt: null });
  }, [asapUnavailable, value.mode, onChange]);

  if (!branchSlug) {
    return (
      <p className="text-sm text-text-muted">Choose a location first to see available times.</p>
    );
  }
  if (today.isPending) return <Skeleton className="h-24" />;
  if (today.isError) {
    return (
      <p role="alert" className="text-sm font-medium text-danger">
        We could not load available times. Reload the page to try again.
      </p>
    );
  }

  const info = today.data;
  const zone = info.timezone;
  const asapDescription = info.asap_available
    ? info.asap_eta
      ? `Ready around ${timeIn(zone, info.asap_eta)}`
      : 'As soon as it is ready'
    : (info.unavailable_message ?? 'Not available right now. Schedule a time instead.');

  return (
    <div className="grid gap-4">
      <RadioGroup
        value={value.mode}
        onValueChange={(mode) =>
          onChange(mode === 'asap' ? { mode: 'asap' } : { mode: 'scheduled', startsAt: null })
        }
        aria-label="When do you want it?"
        className="sm:grid-cols-2"
      >
        <RadioCard
          value="asap"
          disabled={!info.asap_available}
          icon={<Zap aria-hidden="true" />}
          title="As soon as possible"
          description={asapDescription}
        />
        <RadioCard
          value="scheduled"
          icon={<Clock aria-hidden="true" />}
          title="Schedule for later"
          description="Pick a day and a 15-minute window."
        />
      </RadioGroup>

      {value.mode === 'scheduled' ? (
        <Tabs value={activeDay ?? ''} onValueChange={setDay}>
          <TabsList aria-label="Day">
            {days.map((d, i) => (
              <TabsTrigger key={d} value={d}>
                {dayLabel(d, i)}
              </TabsTrigger>
            ))}
          </TabsList>
          {days.map((d) => (
            <TabsContent key={d} value={d}>
              {d !== activeDay ? null : slots.isPending ? (
                <Skeleton className="h-16" />
              ) : slots.isError ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  Could not load times for this day.
                </p>
              ) : slots.data.slots.length === 0 ? (
                <p className="text-sm text-text-muted">
                  {slots.data.unavailable_message ?? 'No times are available on this day.'}
                </p>
              ) : (
                <div
                  role="group"
                  aria-label={`Times on ${format(parseISO(d), 'EEEE d MMMM')}`}
                  className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
                >
                  {slots.data.slots.map((slot) => {
                    const selected = value.startsAt === slot.starts_at;
                    return (
                      <button
                        key={slot.starts_at}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange({ mode: 'scheduled', startsAt: slot.starts_at })}
                        className={cn(
                          'h-11 rounded-md border px-2 text-sm font-medium tabular-nums transition-colors',
                          selected
                            ? 'border-accent bg-accent-soft shadow-[inset_0_0_0_1px_var(--color-accent)]'
                            : 'border-border-strong bg-surface-raised hover:border-text',
                        )}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      ) : null}
    </div>
  );
}
