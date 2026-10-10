import { useState } from 'react';
import { Download, Mail, Search } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  toast,
  type Column,
} from '@/design';
import { downloadNewsletterCsv, useAdminNewsletter } from '@/lib/api/adminMarketing';
import { PAGE_SIZE } from '@/lib/api/adminPeople';
import { describeError, isApiError } from '@/lib/api/errors';
import type { AdminNewsletterSubscriber } from '@/lib/api/peopleTypes';
import { formatDateTime } from '../../people-kit/datetime';
import { useDebouncedSearch, useListState } from '../../people-kit/useListState';

const FILTERS = ['is_active'] as const;
const OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'true', label: 'Subscribed' },
  { value: 'false', label: 'Unsubscribed' },
];

/** Trigger a browser download for a Blob. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const columns: Column<AdminNewsletterSubscriber>[] = [
  { id: 'email', header: 'Email', primary: true, sortable: true, cell: (s) => s.email },
  {
    id: 'status',
    header: 'Status',
    cell: (s) => (
      <Badge tone={s.is_active ? 'success' : 'neutral'}>
        {s.is_active ? 'Subscribed' : 'Unsubscribed'}
      </Badge>
    ),
  },
  {
    id: 'created_at',
    header: 'Subscribed on',
    sortable: true,
    cell: (s) => formatDateTime(s.created_at),
  },
];

export function NewsletterPanel() {
  const { params, update, setPage } = useListState(FILTERS);
  const query = useAdminNewsletter(params);
  const [text, setText] = useDebouncedSearch(params.search ?? '', (v) =>
    update({ search: v || undefined }),
  );
  const [exporting, setExporting] = useState(false);
  const total = query.data?.count ?? 0;
  const ordering = params.ordering as string | undefined;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await downloadNewsletterCsv(params);
      saveBlob(blob, filename ?? 'newsletter-subscribers.csv');
      toast.success('Subscriber list downloaded.');
    } catch (e) {
      toast.error(isApiError(e) ? e.message : describeError(e).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <label htmlFor="newsletter-search" className="sr-only">
            Search subscribers by email
          </label>
          <Input
            id="newsletter-search"
            type="search"
            size="sm"
            leading={<Search aria-hidden="true" />}
            placeholder="Search email"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select
            size="sm"
            aria-label="Filter by subscription status"
            options={OPTIONS}
            value={(params.is_active as string | undefined) ?? 'all'}
            onValueChange={(v) => update({ is_active: v === 'all' ? undefined : v })}
          />
        </div>
        <p className="text-sm text-text-muted" aria-live="polite">
          {query.data ? `${total} subscriber${total === 1 ? '' : 's'}` : ''}
        </p>
        <Button
          className="ml-auto"
          size="sm"
          variant="secondary"
          leadingIcon={<Download aria-hidden="true" className="size-4" />}
          loading={exporting}
          onClick={() => void exportCsv()}
        >
          Export CSV
        </Button>
      </div>
      <p className="mb-3 text-sm text-text-muted">
        The export includes email, status and sign-up date for the current filter, and is recorded
        in the audit log. Handle it according to your privacy policy.
      </p>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Newsletter subscribers"
            columns={columns}
            data={query.data?.results}
            getRowId={(s) => s.id}
            loading={query.isPending}
            sort={
              ordering
                ? {
                    key: ordering.replace(/^-/, ''),
                    direction: ordering.startsWith('-') ? 'desc' : 'asc',
                  }
                : null
            }
            onSortChange={(s) =>
              update({ ordering: s ? `${s.direction === 'desc' ? '-' : ''}${s.key}` : undefined })
            }
            empty={
              <EmptyState
                icon={<Mail aria-hidden="true" />}
                title="No subscribers found"
                description="People who sign up through the website newsletter form appear here."
              />
            }
          />
          <Pagination
            className="mt-4"
            page={params.page ?? 1}
            pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
