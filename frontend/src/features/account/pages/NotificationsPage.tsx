import { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button, EmptyState, ErrorState, Pagination, Skeleton, Switch, toast } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { describeError } from '@/lib/api/errors';
import { useMarkAllNotificationsRead, useNotificationFeed } from '@/lib/api/notificationFeed';
import { AccountShell } from '../components/AccountShell';
import { NotificationRow } from '../components/NotificationRow';

const PAGE_SIZE = 15;

export default function NotificationsPage() {
  useSeo({ title: 'Notifications', noindex: true });
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const feed = useNotificationFeed(page, unreadOnly);
  const markAll = useMarkAllNotificationsRead();
  const items = feed.data?.results ?? [];
  const hasUnread = items.some((n) => !n.is_read);

  return (
    <AccountShell
      title="Notifications"
      description="Updates about your orders and payments."
      actions={
        <Button
          variant="secondary"
          disabled={!hasUnread && !unreadOnly}
          loading={markAll.isPending}
          leadingIcon={<CheckCheck aria-hidden="true" className="size-4" />}
          onClick={() =>
            markAll.mutate(undefined, {
              onSuccess: () => toast.success('All notifications marked as read.'),
              onError: (e) => toast.error(describeError(e).message),
            })
          }
        >
          Mark all as read
        </Button>
      }
    >
      <div className="mb-5 max-w-xs">
        <Switch
          label="Unread only"
          checked={unreadOnly}
          onCheckedChange={(v) => {
            setUnreadOnly(v);
            setPage(1);
          }}
        />
      </div>
      {feed.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : feed.isError ? (
        <ErrorState
          error={feed.error}
          onRetry={() => void feed.refetch()}
          retrying={feed.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell aria-hidden="true" />}
          title={unreadOnly ? 'You are all caught up' : 'No notifications yet'}
          description={
            unreadOnly ? 'There is nothing unread.' : 'Order and payment updates will appear here.'
          }
        />
      ) : (
        <>
          <ul className="grid max-w-3xl gap-1" aria-label="Notifications">
            {items.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
          </ul>
          <Pagination
            className="mt-8"
            page={page}
            pageCount={Math.ceil((feed.data?.count ?? 0) / PAGE_SIZE)}
            onPageChange={setPage}
          />
        </>
      )}
    </AccountShell>
  );
}
