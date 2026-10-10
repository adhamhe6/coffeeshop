import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, Copy, History, Search, UserRound, X } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Pagination,
  Select,
  Skeleton,
  toast,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { PAGE_SIZE } from '@/lib/api/adminPeople';
import { useAuditLogs } from '@/lib/api/adminSettings';
import type { AuditLogEntry } from '@/lib/api/peopleTypes';
import { ADMIN_CAPABILITY_BY_PATH } from '../../nav';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { formatDateTime } from '../../people-kit/datetime';
import { useDebouncedSearch, useListState } from '../../people-kit/useListState';
import { ChangeSummary } from '../components/ChangeSummary';
import { ACTIONS, RESOURCE_TYPES, actionLabel, resourceLabel, resourceLink } from '../auditLogic';

const FILTERS = [
  'actor',
  'action',
  'resource_type',
  'resource_id',
  'date_from',
  'date_to',
] as const;

const ANY = 'all';
const actionOptions = [{ value: ANY, label: 'Any action' }, ...ACTIONS];
const typeOptions = [{ value: ANY, label: 'Any resource' }, ...RESOURCE_TYPES];

export default function AuditLogPage() {
  useSeo({ title: 'Audit log', noindex: true });
  const { params, update, setPage } = useListState(FILTERS);
  const query = useAuditLogs(params);
  const [text, setText] = useDebouncedSearch(params.search ?? '', (v) =>
    update({ search: v || undefined }),
  );
  const total = query.data?.count ?? 0;
  const page = params.page ?? 1;
  const actorId = params.actor ? String(params.actor) : undefined;
  const actorLabel =
    query.data?.results.find((e) => String(e.actor) === actorId)?.actor_label ?? `user #${actorId}`;
  const anyFilter =
    Boolean(params.search) || FILTERS.some((k) => params[k] !== undefined && params[k] !== '');

  const clearAll = () =>
    update({
      search: undefined,
      actor: undefined,
      action: undefined,
      resource_type: undefined,
      resource_id: undefined,
      date_from: undefined,
      date_to: undefined,
    });

  return (
    <div>
      <AdminPageHeader
        title="Audit log"
        description="A permanent, read-only record of who changed what and when. Entries cannot be edited or deleted."
      />

      <form
        role="search"
        aria-label="Filter the audit log"
        onSubmit={(e) => e.preventDefault()}
        className="mb-4 grid gap-3 rounded-lg border border-border bg-surface-raised p-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="sm:col-span-2">
          <label htmlFor="audit-search" className="sr-only">
            Search by person, summary or action
          </label>
          <Input
            id="audit-search"
            type="search"
            size="sm"
            leading={<Search aria-hidden="true" />}
            placeholder="Search who, what or action"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Select
          size="sm"
          aria-label="Action"
          options={actionOptions}
          value={(params.action as string | undefined) ?? ANY}
          onValueChange={(v) => update({ action: v === ANY ? undefined : v })}
        />
        <Select
          size="sm"
          aria-label="Resource type"
          options={typeOptions}
          value={(params.resource_type as string | undefined) ?? ANY}
          onValueChange={(v) => update({ resource_type: v === ANY ? undefined : v })}
        />
        <Field label="Resource ID" className="[&>div:first-child]:text-xs">
          <Input
            size="sm"
            inputMode="text"
            value={(params.resource_id as string | undefined) ?? ''}
            onChange={(e) => update({ resource_id: e.target.value.trim() || undefined })}
          />
        </Field>
        <Field label="From date" className="[&>div:first-child]:text-xs">
          <Input
            size="sm"
            type="date"
            value={(params.date_from as string | undefined) ?? ''}
            max={(params.date_to as string | undefined) || undefined}
            onChange={(e) => update({ date_from: e.target.value || undefined })}
          />
        </Field>
        <Field label="To date" className="[&>div:first-child]:text-xs">
          <Input
            size="sm"
            type="date"
            value={(params.date_to as string | undefined) ?? ''}
            min={(params.date_from as string | undefined) || undefined}
            onChange={(e) => update({ date_to: e.target.value || undefined })}
          />
        </Field>
        <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-1">
          {actorId ? (
            <Badge tone="accent" className="h-9 gap-1.5 pr-1 pl-3 text-sm">
              <UserRound aria-hidden="true" />
              {actorLabel}
              <button
                type="button"
                aria-label="Clear the person filter"
                className="flex size-7 items-center justify-center rounded-full hover:bg-surface/60"
                onClick={() => update({ actor: undefined })}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </Badge>
          ) : null}
          {anyFilter ? (
            <Button variant="secondary" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </form>

      <p className="mb-2 text-sm text-text-muted" aria-live="polite">
        {query.data ? `${total} entr${total === 1 ? 'y' : 'ies'}` : ''}
      </p>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : query.data.results.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-raised">
          <EmptyState
            icon={<History aria-hidden="true" />}
            title={anyFilter ? 'No entries match these filters' : 'Nothing recorded yet'}
            description={
              anyFilter
                ? 'Widen the date range or clear a filter.'
                : 'Changes made by staff will be listed here.'
            }
            action={
              anyFilter ? (
                <Button variant="secondary" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ol
          aria-label="Audit entries, newest first"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-raised"
        >
          {query.data.results.map((entry) => (
            <AuditRow
              key={entry.id}
              entry={entry}
              onFilterActor={(id) => update({ actor: String(id) })}
            />
          ))}
        </ol>
      )}

      <Pagination
        className="mt-4"
        page={page}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
      />
    </div>
  );
}

function AuditRow({
  entry,
  onFilterActor,
}: {
  entry: AuditLogEntry;
  onFilterActor: (id: number) => void;
}) {
  const { hasCapability } = useAuth();
  const [open, setOpen] = useState(false);
  const link = resourceLink(entry);
  const linkCapability = link
    ? ADMIN_CAPABILITY_BY_PATH[`/${link.split('/').slice(1, 3).join('/')}`]
    : undefined;
  const canOpen = link && (!linkCapability || hasCapability(linkCapability));
  const panelId = `audit-${entry.id}`;

  const copyRequestId = async () => {
    try {
      await navigator.clipboard.writeText(entry.request_id);
      toast.success('Request ID copied.');
    } catch {
      toast.error('Could not copy. Select the ID and copy it manually.');
    }
  };

  return (
    <li>
      <div className="grid gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[10.5rem_minmax(0,14rem)_minmax(0,1fr)_auto] md:items-center">
        <time dateTime={entry.created_at} className="text-sm text-text-muted tabular-nums">
          {formatDateTime(entry.created_at)}
        </time>
        <div className="min-w-0 text-sm">
          {entry.actor ? (
            <button
              type="button"
              onClick={() => onFilterActor(entry.actor as number)}
              title="Show only this person's activity"
              aria-label={`Filter by ${entry.actor_label}`}
              className="max-w-full truncate rounded-xs text-left font-medium underline-offset-4 hover:text-accent-text hover:underline"
            >
              {entry.actor_label}
            </button>
          ) : (
            <span className="font-medium">{entry.actor_label}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{actionLabel(entry.action)}</p>
          <p className="text-sm break-words text-text-muted">{entry.summary || '—'}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Hide details' : 'Details'} for ${actionLabel(entry.action)}`}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-9 items-center gap-1 justify-self-start rounded-md px-2 text-sm font-medium text-accent-text hover:bg-surface-sunken md:justify-self-end"
        >
          {open ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4" />
          )}
          {open ? 'Hide details' : 'Details'}
        </button>
      </div>
      {open ? (
        <div
          id={panelId}
          className="grid gap-4 border-t border-border bg-surface px-4 py-4 md:pl-[11.5rem]"
        >
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-muted">Target</dt>
              <dd className="font-medium">
                {resourceLabel(entry.resource_type)}
                {entry.resource_id ? ` #${entry.resource_id}` : ''}
                {canOpen && link ? (
                  <>
                    {' · '}
                    <Link to={link} className="text-accent-text underline underline-offset-4">
                      Open in dashboard
                    </Link>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Action code</dt>
              <dd className="font-mono text-xs">{entry.action}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Request ID</dt>
              <dd className="flex items-center gap-1">
                <code className="font-mono text-xs break-all">{entry.request_id || '—'}</code>
                {entry.request_id ? (
                  <IconButton
                    label="Copy request ID"
                    size="icon-sm"
                    icon={<Copy aria-hidden="true" className="size-3.5" />}
                    onClick={() => void copyRequestId()}
                  />
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">IP address</dt>
              <dd className="font-mono text-xs">{entry.ip_address ?? '—'}</dd>
            </div>
          </dl>
          <div>
            <h3 className="mb-1 text-sm font-semibold">What changed</h3>
            <ChangeSummary entry={entry} />
          </div>
        </div>
      ) : null}
    </li>
  );
}
