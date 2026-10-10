import { Bell, BellDot } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from '@/design';
import { describeError } from '@/lib/api/errors';
import { useMarkNotificationRead, type AppNotification } from '@/lib/api/notificationFeed';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/features/orders/format';

/** One notification. Opening it marks it read and goes to its order, when it has one. */
export function NotificationRow({
  notification,
  onOpen,
  compact,
}: {
  notification: AppNotification;
  onOpen?: () => void;
  compact?: boolean;
}) {
  const markRead = useMarkNotificationRead();
  const navigate = useNavigate();
  const open = () => {
    if (!notification.is_read) {
      markRead.mutate(notification.id, {
        onError: (e) => toast.error(describeError(e).message),
      });
    }
    onOpen?.();
    if (notification.order_number)
      navigate(`/orders/${encodeURIComponent(notification.order_number)}`);
  };
  const Icon = notification.is_read ? Bell : BellDot;
  return (
    <li>
      <button
        type="button"
        onClick={open}
        data-read={notification.is_read}
        className={cn(
          'flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors hover:bg-surface-sunken',
          !notification.is_read && 'bg-accent-soft/60',
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            'mt-0.5 size-5 shrink-0',
            notification.is_read ? 'text-text-muted' : 'text-accent-text',
          )}
        />
        <span className="grid min-w-0 gap-0.5">
          <span className={cn('text-[0.9375rem]', !notification.is_read && 'font-semibold')}>
            {!notification.is_read ? <span className="sr-only">Unread: </span> : null}
            {notification.title}
          </span>
          {notification.body && !compact ? (
            <span className="text-sm text-text-muted">{notification.body}</span>
          ) : null}
          <span className="text-xs text-text-muted">{formatDateTime(notification.created_at)}</span>
        </span>
      </button>
    </li>
  );
}
