import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Ban, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Money,
  Skeleton,
  Stat,
  StatusBadge,
  toast,
  type Column,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useAdminCustomer, useRestoreCustomer, useSuspendCustomer } from '@/lib/api/adminPeople';
import { describeError, isApiError } from '@/lib/api/errors';
import type { AdminCustomerDetail, AdminOrderSummary } from '@/lib/api/peopleTypes';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { Callout } from '../../people-kit/Callout';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { formatDateTime, formatRelative } from '../../people-kit/datetime';
import { AccountStatusBadge } from '../components/AccountStatusBadge';

const orderColumns: Column<AdminOrderSummary>[] = [
  {
    id: 'number',
    header: 'Order',
    primary: true,
    cell: (o) => (
      <Link
        to={`/admin/orders/${encodeURIComponent(o.number)}`}
        className="font-medium whitespace-nowrap text-accent-text underline underline-offset-4 hover:decoration-2"
      >
        {o.number}
      </Link>
    ),
  },
  { id: 'placed', header: 'Placed', cell: (o) => formatDateTime(o.placed_at) },
  { id: 'status', header: 'Status', cell: (o) => <StatusBadge kind="order" status={o.status} /> },
  {
    id: 'payment',
    header: 'Payment',
    hideOnNarrow: true,
    cell: (o) => <StatusBadge kind="payment" status={o.payment_status} />,
  },
  {
    id: 'type',
    header: 'Type',
    hideOnNarrow: true,
    cell: (o) => <span className="capitalize">{o.order_type.toLowerCase()}</span>,
  },
  { id: 'branch', header: 'Branch', hideOnNarrow: true, cell: (o) => o.branch_name },
  {
    id: 'total',
    header: 'Total',
    align: 'right',
    cell: (o) => <Money value={o.total} />,
  },
];

export default function CustomerDetailPage() {
  const { id } = useParams();
  const query = useAdminCustomer(id);
  const customer = query.data;
  useSeo({ title: customer ? customer.full_name || customer.email : 'Customer', noindex: true });

  if (query.isPending) {
    return (
      <div aria-busy="true" className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !customer) {
    return (
      <div>
        <AdminPageHeader
          title="Customer"
          back={{ to: '/admin/customers', label: 'All customers' }}
        />
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </div>
    );
  }
  return <CustomerProfile customer={customer} />;
}

function CustomerProfile({ customer }: { customer: AdminCustomerDetail }) {
  const { hasCapability, staff } = useAuth();
  const canManage = hasCapability('customers.manage');
  const [dialog, setDialog] = useState<'suspend' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suspend = useSuspendCustomer(customer.id);
  const restore = useRestoreCustomer(customer.id);
  const scoped = staff?.role === 'BRANCH_MANAGER' && staff.branch_ids !== null;
  const name = customer.full_name || customer.email;

  const close = (open: boolean) => {
    if (!open) {
      setDialog(null);
      setError(null);
    }
  };
  const fail = (e: unknown) => setError(isApiError(e) ? e.message : describeError(e).message);

  return (
    <div>
      <AdminPageHeader
        title={name}
        back={{ to: '/admin/customers', label: 'All customers' }}
        meta={
          <>
            <AccountStatusBadge active={customer.is_active} />
            {customer.marketing_opt_in ? (
              <Badge tone="outline">Accepts marketing email</Badge>
            ) : null}
            <span className="text-sm text-text-muted">
              Joined {formatDateTime(customer.date_joined, { withTime: false })}
            </span>
          </>
        }
        actions={
          canManage ? (
            customer.is_active ? (
              <Button
                variant="danger"
                size="sm"
                leadingIcon={<Ban aria-hidden="true" className="size-4" />}
                onClick={() => setDialog('suspend')}
              >
                Suspend account
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ShieldCheck aria-hidden="true" className="size-4" />}
                onClick={() => setDialog('restore')}
              >
                Restore account
              </Button>
            )
          ) : null
        }
      />

      {!customer.is_active ? (
        <Callout tone="danger" title="This account is suspended" role="status" className="mb-4">
          The customer cannot sign in or place orders.
          {customer.restriction_reason ? (
            <>
              {' '}
              Reason on file (visible to staff only): <strong>{customer.restriction_reason}</strong>
            </>
          ) : null}
        </Callout>
      ) : null}
      {scoped ? (
        <Callout className="mb-4" title="Your branches only">
          Orders and spend below only include activity at the branches you manage.
        </Callout>
      ) : null}

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Lifetime spend"
          value={<Money value={customer.lifetime_spend} />}
          hint="Completed, paid orders minus refunds"
        />
        <Stat label="Orders" value={customer.order_count} hint="Completed, paid orders" />
        <Stat
          label="Last order"
          value={customer.last_order_at ? formatRelative(customer.last_order_at) : 'None yet'}
          hint={customer.last_order_at ? formatDateTime(customer.last_order_at) : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="grid content-start gap-6">
          <section
            aria-labelledby="contact-h"
            className="rounded-lg border border-border bg-surface-raised p-4"
          >
            <h2
              id="contact-h"
              className="mb-3 text-sm font-semibold tracking-wide text-text-muted uppercase"
            >
              Contact
            </h2>
            <dl className="grid gap-3 text-sm">
              <div className="flex items-start gap-2.5">
                <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <div>
                  <dt className="sr-only">Email</dt>
                  <dd className="break-all">{customer.email}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Phone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <div>
                  <dt className="sr-only">Phone</dt>
                  <dd>
                    {customer.phone || <span className="text-text-muted">No phone on file</span>}
                  </dd>
                </div>
              </div>
              <div className="border-t border-border pt-3 text-text-muted">
                <dt className="inline">Last sign-in: </dt>
                <dd className="inline">
                  {customer.last_login ? formatDateTime(customer.last_login) : 'Never'}
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="addr-h"
            className="rounded-lg border border-border bg-surface-raised p-4"
          >
            <h2
              id="addr-h"
              className="mb-3 text-sm font-semibold tracking-wide text-text-muted uppercase"
            >
              Saved addresses
            </h2>
            {customer.addresses.length === 0 ? (
              <p className="text-sm text-text-muted">No saved addresses.</p>
            ) : (
              <ul className="grid gap-3">
                {customer.addresses.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 text-sm">
                    <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                    <address className="not-italic">
                      <span className="font-medium">
                        {a.label || 'Address'}
                        {a.is_default ? (
                          <Badge tone="outline" size="sm" className="ml-2 align-middle">
                            Default
                          </Badge>
                        ) : null}
                      </span>
                      <br />
                      {a.recipient_name}
                      <br />
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ''}
                      <br />
                      {a.city} {a.postal_code}
                      {a.zone_name ? (
                        <>
                          <br />
                          <span className="text-text-muted">Delivery zone: {a.zone_name}</span>
                        </>
                      ) : null}
                    </address>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section aria-labelledby="orders-h" className="min-w-0">
          <h2
            id="orders-h"
            className="mb-3 text-sm font-semibold tracking-wide text-text-muted uppercase"
          >
            Recent orders
          </h2>
          <DataTable
            caption={`Recent orders for ${name}`}
            columns={orderColumns}
            data={customer.recent_orders}
            getRowId={(o) => o.number}
            empty={
              <EmptyState
                title="No orders yet"
                description="Orders placed by this customer will be listed here."
              />
            }
          />
        </section>
      </div>

      <ConfirmDialog
        open={dialog === 'suspend'}
        onOpenChange={close}
        title={`Suspend ${name}?`}
        description="They will be signed out and unable to log in or place orders until you restore the account. Existing orders are not affected."
        confirmLabel="Suspend account"
        tone="danger"
        loading={suspend.isPending}
        error={error}
        reason={{
          label: 'Reason',
          required: true,
          maxLength: 200,
          hint: 'Only staff can see this. It is saved in the audit log.',
        }}
        onConfirm={async (reason) => {
          setError(null);
          try {
            await suspend.mutateAsync(reason);
            toast.success(`${name} has been suspended.`);
            close(false);
          } catch (e) {
            fail(e);
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'restore'}
        onOpenChange={close}
        title={`Restore ${name}?`}
        description="They will be able to sign in and order again."
        confirmLabel="Restore account"
        loading={restore.isPending}
        error={error}
        onConfirm={async () => {
          setError(null);
          try {
            await restore.mutateAsync();
            toast.success(`${name} has been restored.`);
            close(false);
          } catch (e) {
            fail(e);
          }
        }}
      />
    </div>
  );
}
