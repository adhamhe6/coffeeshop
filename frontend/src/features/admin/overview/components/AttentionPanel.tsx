import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CircleCheckBig,
  CreditCard,
  Hourglass,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '@/app/auth';
import { Panel } from '../../ops/PageHeader';
import { DefinitionTip } from '../../ops/DefinitionTip';
import type { Dashboard } from '@/lib/api/adminReports';
import { cn } from '@/lib/cn';

interface Row {
  key: string;
  label: string;
  definitionKey: string;
  count: number;
  to: string;
  capability: string;
  icon: ReactNode;
  hint: string;
}

/** Things that need a person today. Each row links to the matching filtered page; rows for pages the role cannot open are not shown. */
export function AttentionPanel({ attention }: { attention: Dashboard['attention'] }) {
  const { hasCapability } = useAuth();
  const rows: Row[] = [
    {
      key: 'stuck',
      label: 'Stuck orders',
      definitionKey: 'attention_stuck_orders',
      count: attention.stuck_orders,
      to: '/admin/orders?view=table&stuck=true',
      capability: 'orders.view',
      icon: <Hourglass aria-hidden="true" className="size-4" />,
      hint: 'Open orders waiting too long',
    },
    {
      key: 'failed',
      label: 'Failed payments',
      definitionKey: 'attention_failed_payments',
      count: attention.failed_payments,
      to: '/admin/payments?failed=true',
      capability: 'payments.view',
      icon: <CreditCard aria-hidden="true" className="size-4" />,
      hint: 'Open orders whose payment failed',
    },
    {
      key: 'refund',
      label: 'Refunds needed',
      definitionKey: 'attention_refund_needed',
      count: attention.refund_needed,
      to: '/admin/payments?needs_refund=true',
      capability: 'payments.view',
      icon: <Undo2 aria-hidden="true" className="size-4" />,
      hint: 'Cancelled after payment, money not returned',
    },
    {
      key: 'stock',
      label: 'Low or out of stock',
      definitionKey: 'low_stock_products',
      count: attention.low_stock,
      to: '/admin/inventory?status=low',
      capability: 'inventory.view',
      icon: <Boxes aria-hidden="true" className="size-4" />,
      hint: 'Products at or below their threshold',
    },
  ].filter((r) => hasCapability(r.capability));

  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <Panel
      title="Needs attention"
      description="Right now, not limited to the selected dates."
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-text-muted">Nothing here applies to your role.</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-2 px-4 py-2.5">
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-md',
                    r.count > 0
                      ? 'bg-warning-bg text-warning'
                      : 'bg-surface-sunken text-text-muted',
                  )}
                >
                  {r.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-0.5 text-sm font-medium">
                    {r.label}
                    <DefinitionTip definitionKey={r.definitionKey} label={r.label} />
                  </p>
                  <p className="text-xs text-text-muted">{r.hint}</p>
                </div>
                <span
                  className="text-lg font-semibold tabular-nums"
                  aria-label={`${r.count} ${r.label.toLowerCase()}`}
                >
                  {r.count}
                </span>
                {r.count > 0 ? (
                  <Link
                    to={r.to}
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-accent-text hover:bg-accent-soft"
                    aria-label={`Review ${r.label.toLowerCase()}`}
                  >
                    Review <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                ) : (
                  <span className="w-[4.5rem]" />
                )}
              </li>
            ))}
          </ul>
          {total === 0 ? (
            <p className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm text-text-muted">
              <CircleCheckBig aria-hidden="true" className="size-4 text-success" /> All clear.
              Nothing is waiting on you.
            </p>
          ) : (
            <p className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm text-text-muted">
              <AlertTriangle aria-hidden="true" className="size-4 text-warning" /> {total} item
              {total === 1 ? '' : 's'} to look at.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
