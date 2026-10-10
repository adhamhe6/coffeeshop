import { Ban, CalendarClock, CircleCheckBig, Hourglass, PackageX, Zap } from 'lucide-react';
import { Badge, type BadgeTone } from '@/design';
import { COUPON_STATUS_LABEL, type CouponStatusKey } from '../couponLogic';

const STATUS: Record<CouponStatusKey, { tone: BadgeTone; icon: typeof Ban }> = {
  active: { tone: 'success', icon: CircleCheckBig },
  scheduled: { tone: 'info', icon: CalendarClock },
  expired: { tone: 'neutral', icon: Hourglass },
  exhausted: { tone: 'warning', icon: PackageX },
  inactive: { tone: 'neutral', icon: Ban },
};

/** Status (+ "Automatic" for promotions that need no code). Icon and text on every chip. */
export function CouponStatusChips({
  status,
  automatic,
}: {
  status: CouponStatusKey;
  automatic?: boolean;
}) {
  const { tone, icon: Icon } = STATUS[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={tone}>
        <Icon aria-hidden="true" />
        {COUPON_STATUS_LABEL[status]}
      </Badge>
      {automatic ? (
        <Badge tone="accent">
          <Zap aria-hidden="true" />
          Automatic
        </Badge>
      ) : null}
    </span>
  );
}
