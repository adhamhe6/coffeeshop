import { FlaskConical, Flag } from 'lucide-react';
import { Badge, Money } from '@/design';
import type { AdminPaymentDetail, AdminRefund } from '@/lib/api/adminPayments';
import { formatDateTime, humanise } from '../../ops/format';

/** Sandbox payments never moved real money. Said in words, not just colour. */
export function SandboxTag({ provider }: { provider?: string }) {
  return (
    <Badge tone="outline" title="No real money moved for this payment">
      <FlaskConical aria-hidden="true" />
      {provider === 'demo' ? 'Demo sandbox' : 'Sandbox'}
    </Badge>
  );
}

export function FlaggedTag({ reason }: { reason: string }) {
  if (!reason) return null;
  const text =
    reason === 'duplicate_charge'
      ? 'Duplicate charge'
      : reason === 'amount_mismatch'
        ? 'Amount mismatch'
        : humanise(reason);
  return (
    <Badge tone="warning">
      <Flag aria-hidden="true" />
      Flagged: {text}
    </Badge>
  );
}

const REFUND_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  SUCCEEDED: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
};

export function RefundList({ refunds }: { refunds: AdminRefund[] }) {
  if (refunds.length === 0)
    return <p className="text-sm text-text-muted">No refunds on this payment.</p>;
  return (
    <ul className="grid gap-2">
      {refunds.map((r) => (
        <li key={r.id} className="rounded-md border border-border p-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              <Money value={r.amount} />
            </span>
            <Badge tone={REFUND_TONE[r.status] ?? 'neutral'}>{humanise(r.status)}</Badge>
          </div>
          {r.reason ? <p className="mt-1">{r.reason}</p> : null}
          {r.status === 'PENDING' ? (
            <p className="mt-1 text-xs text-text-muted">
              Waiting for the provider to confirm. This updates by itself.
            </p>
          ) : null}
          {r.failure_message ? (
            <p className="mt-1 text-xs font-medium text-danger">{r.failure_message}</p>
          ) : null}
          <p className="mt-1 text-xs text-text-muted">
            {formatDateTime(r.created_at)}
            {r.initiated_by ? ` · by ${r.initiated_by}` : ''}
            {r.reference ? ` · ref ${r.reference}` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function EventTimeline({ events }: { events: AdminPaymentDetail['events'] }) {
  if (events.length === 0)
    return (
      <p className="text-sm text-text-muted">
        No provider events recorded. Cash and seeded payments have none.
      </p>
    );
  return (
    <ol className="relative grid gap-3 border-l border-border-strong pl-4">
      {events.map((e) => (
        <li key={e.id} className="text-sm">
          <span
            aria-hidden="true"
            className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface-raised bg-border-strong"
          />
          <p className="font-medium">{e.event_type}</p>
          <p className="text-xs text-text-muted">
            {formatDateTime(e.received_at)} · {humanise(e.outcome)}
          </p>
          {e.error ? <p className="text-xs text-danger">{e.error}</p> : null}
          <p className="truncate text-xs text-text-muted" title={e.event_id}>
            {e.event_id}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-muted">{k}</dt>
            <dd className="min-w-0 text-right break-words">{v}</dd>
          </div>
        ))}
    </dl>
  );
}
