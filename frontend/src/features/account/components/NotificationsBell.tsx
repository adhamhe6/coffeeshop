import { useState } from 'react';
import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton, toast } from '@/design';
import { describeError } from '@/lib/api/errors';
import { useUnreadNotifications } from '@/lib/api/notifications';
import { useMarkAllNotificationsRead, useNotificationFeed } from '@/lib/api/notificationFeed';
import { NotificationRow } from './NotificationRow';

/** Header bell: unread badge and a popover with the latest notifications. Shown to signed-in customers only. */
export function NotificationsBell() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const unread = useUnreadNotifications(isAuthenticated).data ?? 0;
  const feed = useNotificationFeed(1, false, isAuthenticated && open);
  const markAll = useMarkAllNotificationsRead();
  if (!isAuthenticated) return null;
  const items = (feed.data?.results ?? []).slice(0, 6);
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={label} aria-haspopup="dialog">
            <Bell aria-hidden="true" className="size-[1.375rem]" />
          </Button>
        </PopoverTrigger>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-1 text-[0.6875rem] leading-none font-semibold text-accent-foreground tabular-nums"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </div>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-display text-h4 font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            loading={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onError: (e) => toast.error(describeError(e).message),
              })
            }
          >
            Mark all read
          </Button>
        </div>
        <div className="max-h-[22rem] overflow-y-auto p-1.5">
          {feed.isPending ? (
            <div className="grid gap-2 p-2" aria-busy="true">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : feed.isError ? (
            <p role="alert" className="p-4 text-sm text-danger">
              We could not load your notifications.
            </p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">
              Nothing here yet. Order updates will show up.
            </p>
          ) : (
            <ul aria-label="Latest notifications">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  compact
                  onOpen={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border p-2">
          <Button asChild variant="ghost" size="sm" block onClick={() => setOpen(false)}>
            <Link to="/account/notifications">View all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
