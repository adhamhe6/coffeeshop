import { useState } from 'react';
import { Link } from 'react-router';
import { Money, StatusBadge } from '@/design';
import { useAuth } from '@/app/auth';
import type { Dashboard } from '@/lib/api/adminReports';
import { BarList } from '../../ops/BarList';
import { Panel } from '../../ops/PageHeader';
import { Segmented } from '../../ops/Segmented';
import { formatDateTime, formatInt, formatPct } from '../../ops/format';
import { DefinitionTip } from '../../ops/DefinitionTip';

export function StatusPanel({ rows }: { rows: Dashboard['orders_by_status'] }) {
  const { hasCapability } = useAuth();
  const canOpen = hasCapability('orders.view');
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <Panel title="Orders by status" description={`${formatInt(total)} placed in this period`}>
      {total === 0 ? (
        <p className="text-sm text-text-muted">No orders were placed in this period.</p>
      ) : (
        <BarList
          label="Orders by status"
          items={rows.map((r) => ({
            key: r.status,
            value: r.count,
            label: canOpen ? (
              <Link
                to={`/admin/orders?view=table&status=${r.status}`}
                className="rounded-xs underline-offset-4 hover:underline"
              >
                {r.label}
              </Link>
            ) : (
              r.label
            ),
            display: (
              <>
                {formatInt(r.count)}{' '}
                <span className="font-normal text-text-muted">· {formatPct(r.share)}</span>
              </>
            ),
          }))}
        />
      )}
    </Panel>
  );
}

export function CategoryPanel({ rows }: { rows: Dashboard['category_sales'] }) {
  return (
    <Panel
      title="Sales by category"
      description="Net sales, top categories"
      actions={<DefinitionTip definitionKey="category_sales" label="Category sales" />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No sales in this period.</p>
      ) : (
        <BarList
          label="Net sales by category"
          items={rows.map((r) => ({
            key: r.category,
            label: r.category,
            value: Number(r.net),
            display: <Money value={r.net} />,
            hint: `${formatInt(r.units)} units · ${formatPct(r.share)} of net`,
          }))}
        />
      )}
    </Panel>
  );
}

export function TopProductsPanel({ products }: { products: Dashboard['top_products'] }) {
  const [by, setBy] = useState<'units' | 'revenue'>('units');
  const rows = by === 'units' ? products.by_units : products.by_revenue;
  return (
    <Panel
      title="Top products"
      actions={
        <Segmented
          label="Rank products by"
          value={by}
          onChange={setBy}
          options={[
            { value: 'units', label: 'Units' },
            { value: 'revenue', label: 'Revenue' },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No product sales in this period.</p>
      ) : (
        <BarList
          label={`Top products by ${by}`}
          items={rows.map((r) => ({
            key: r.sku,
            label: r.product_name,
            value: by === 'units' ? r.units : Number(r.revenue),
            display: by === 'units' ? <>{formatInt(r.units)} units</> : <Money value={r.revenue} />,
            hint:
              by === 'units' ? (
                <>
                  <Money value={r.revenue} /> revenue
                </>
              ) : (
                `${formatInt(r.units)} units`
              ),
          }))}
        />
      )}
    </Panel>
  );
}

export function BranchPanel({ rows }: { rows: Dashboard['branch_performance'] }) {
  return (
    <Panel title="Branch performance" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Branch performance for the selected period</caption>
          <thead className="bg-surface-sunken text-xs text-text-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-semibold">
                Branch
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Orders
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Net sales
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Avg order
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.branch_id} className="border-t border-border">
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {b.branch}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{formatInt(b.orders)}</td>
                <td className="px-3 py-2 text-right">
                  <Money value={b.net_sales} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money value={b.average_order_value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function RecentOrdersPanel({ rows }: { rows: Dashboard['recent_orders'] }) {
  const { hasCapability } = useAuth();
  const canOpen = hasCapability('orders.view');
  return (
    <Panel
      title="Recent orders"
      bodyClassName="p-0"
      actions={
        canOpen ? (
          <Link
            to="/admin/orders"
            className="rounded-xs text-sm font-medium text-accent-text underline-offset-4 hover:underline"
          >
            All orders
          </Link>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-text-muted">No orders yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((o) => (
            <li key={o.number} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {canOpen ? (
                    <Link
                      to={`/admin/orders/${encodeURIComponent(o.number)}`}
                      className="rounded-xs tabular-nums underline-offset-4 hover:underline"
                    >
                      {o.number}
                    </Link>
                  ) : (
                    <span className="tabular-nums">{o.number}</span>
                  )}
                </p>
                <p className="truncate text-xs text-text-muted">
                  {o.customer} · {o.branch} · {formatDateTime(o.placed_at)}
                </p>
              </div>
              <StatusBadge kind="order" status={o.status} />
              <span className="w-16 text-right text-sm font-medium">
                <Money value={o.total} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RecentCustomersPanel({ rows }: { rows: Dashboard['recent_customers'] }) {
  return (
    <Panel title="New customers" bodyClassName="p-0">
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-text-muted">No new sign-ups yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((c, i) => (
            <li
              key={`${c.name}-${c.joined_at}-${i}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-text-muted">{formatDateTime(c.joined_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
