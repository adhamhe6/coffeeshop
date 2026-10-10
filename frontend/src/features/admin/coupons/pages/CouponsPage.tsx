import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Copy, MoreHorizontal, Pencil, Percent, Plus, Power, Search, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Money,
  Pagination,
  Select,
  fromOrdering,
  toOrdering,
  toast,
  type Column,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useAdminCoupons, useDeleteCoupon, useToggleCoupon } from '@/lib/api/adminMarketing';
import { PAGE_SIZE } from '@/lib/api/adminPeople';
import { describeError, isApiError } from '@/lib/api/errors';
import type { AdminCoupon } from '@/lib/api/peopleTypes';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { formatDateTime } from '../../people-kit/datetime';
import { useDebouncedSearch, useListState } from '../../people-kit/useListState';
import { useStoreTimeZone } from '../../people-kit/useStoreTimeZone';
import { CouponStatusChips } from '../components/CouponStatusChips';
import { couponStatus } from '../couponLogic';

const FILTERS = ['is_active', 'is_automatic'] as const;

const ACTIVE_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'true', label: 'Switched on' },
  { value: 'false', label: 'Switched off' },
];
const KIND_OPTIONS = [
  { value: 'all', label: 'Codes and automatic' },
  { value: 'false', label: 'Codes only' },
  { value: 'true', label: 'Automatic only' },
];

export default function CouponsPage() {
  useSeo({ title: 'Coupons & promotions', noindex: true });
  const navigate = useNavigate();
  const { params, update, setPage } = useListState(FILTERS);
  const query = useAdminCoupons(params);
  const toggle = useToggleCoupon();
  const del = useDeleteCoupon();
  const { timeZone } = useStoreTimeZone();
  const [text, setText] = useDebouncedSearch(String(params.q ?? ''), (v) =>
    update({ q: v || undefined }),
  );
  const [deleting, setDeleting] = useState<AdminCoupon | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const total = query.data?.count ?? 0;
  const page = params.page ?? 1;
  const sort = fromOrdering(params.ordering as string | undefined);

  const flip = async (c: AdminCoupon) => {
    try {
      await toggle.mutateAsync({ id: c.id, is_active: !c.is_active });
      toast.success(`${c.code} was ${c.is_active ? 'deactivated' : 'activated'}.`);
    } catch (e) {
      toast.error(isApiError(e) ? e.message : describeError(e).message);
    }
  };

  const columns: Column<AdminCoupon>[] = [
    {
      id: 'code',
      header: 'Coupon',
      primary: true,
      sortable: true,
      cell: (c) => (
        <div className="min-w-0">
          <Link
            to={`/admin/coupons/${c.id}`}
            className="font-mono text-sm font-semibold underline-offset-4 hover:text-accent-text hover:underline"
          >
            {c.is_automatic && c.code.startsWith('AUTO-') ? 'Automatic' : c.code}
          </Link>
          <div className="truncate text-sm text-text-muted">{c.name}</div>
        </div>
      ),
    },
    {
      id: 'offer',
      header: 'Offer',
      cell: (c) => (
        <div>
          <span className="font-medium">
            {c.discount_type === 'PERCENT' ? (
              `${Number(c.value)}% off`
            ) : (
              <>
                <Money value={c.value} /> off
              </>
            )}
          </span>
          <div className="text-sm text-text-muted">
            {c.applies_to === 'ALL'
              ? 'Whole order'
              : c.applies_to === 'CATEGORIES'
                ? `${c.category_ids.length} categor${c.category_ids.length === 1 ? 'y' : 'ies'}`
                : `${c.product_ids.length} product${c.product_ids.length === 1 ? '' : 's'}`}
            {Number(c.min_order_total) > 0 ? (
              <>
                {' '}
                · min <Money value={c.min_order_total} />
              </>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => <CouponStatusChips status={couponStatus(c)} automatic={c.is_automatic} />,
    },
    {
      id: 'window',
      header: 'Runs',
      hideOnNarrow: true,
      cell: (c) =>
        c.starts_at || c.ends_at ? (
          <span className="text-sm">
            {c.starts_at ? formatDateTime(c.starts_at, { timeZone, withTime: false }) : 'Now'}
            {' → '}
            {c.ends_at ? formatDateTime(c.ends_at, { timeZone, withTime: false }) : 'No end'}
          </span>
        ) : (
          <span className="text-text-muted">Always</span>
        ),
    },
    {
      id: 'times_redeemed',
      header: 'Used',
      sortable: true,
      align: 'right',
      cell: (c) => (
        <span className="whitespace-nowrap tabular-nums">
          {c.redemption_count}
          {c.usage_limit !== null && c.usage_limit !== undefined ? (
            <span className="text-text-muted"> / {c.usage_limit}</span>
          ) : (
            <span className="text-text-muted"> / unlimited</span>
          )}
        </span>
      ),
    },
    {
      id: 'total_discount',
      header: 'Discount given',
      align: 'right',
      cell: (c) => <Money value={c.total_discount} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      narrowLabel: 'Actions',
      align: 'right',
      cell: (c) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={`Actions for ${c.code}`}
              size="icon-sm"
              icon={<MoreHorizontal aria-hidden="true" className="size-4" />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(`/admin/coupons/${c.id}`)}>
              <Pencil aria-hidden="true" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/admin/coupons/new?clone=${c.id}`)}>
              <Copy aria-hidden="true" /> Clone
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void flip(c)}>
              <Power aria-hidden="true" /> {c.is_active ? 'Deactivate' : 'Activate'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setDeleteError(null);
                setDeleting(c);
              }}
            >
              <Trash2 aria-hidden="true" /> Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filtered = Boolean(params.q || params.is_active || params.is_automatic);

  return (
    <div>
      <AdminPageHeader
        title="Coupons & promotions"
        description="Discount codes customers type at checkout, and automatic promotions applied when the rules match."
        actions={
          <Button asChild size="sm" leadingIcon={<Plus aria-hidden="true" className="size-4" />}>
            <Link to="/admin/coupons/new">New coupon</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-72">
          <label htmlFor="coupon-search" className="sr-only">
            Search coupons by code or name
          </label>
          <Input
            id="coupon-search"
            type="search"
            size="sm"
            leading={<Search aria-hidden="true" />}
            placeholder="Search code or name"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select
            size="sm"
            aria-label="Filter by switched on or off"
            options={ACTIVE_OPTIONS}
            value={(params.is_active as string | undefined) ?? 'all'}
            onValueChange={(v) => update({ is_active: v === 'all' ? undefined : v })}
          />
        </div>
        <div className="w-48">
          <Select
            size="sm"
            aria-label="Filter by codes or automatic"
            options={KIND_OPTIONS}
            value={(params.is_automatic as string | undefined) ?? 'all'}
            onValueChange={(v) => update({ is_automatic: v === 'all' ? undefined : v })}
          />
        </div>
        <p className="ml-auto text-sm text-text-muted" aria-live="polite">
          {query.data ? `${total} coupon${total === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Coupons and promotions"
            columns={columns}
            data={query.data?.results}
            getRowId={(c) => c.id}
            loading={query.isPending}
            sort={sort}
            onSortChange={(s) => update({ ordering: toOrdering(s) })}
            empty={
              <EmptyState
                icon={<Percent aria-hidden="true" />}
                title={filtered ? 'No coupons match' : 'No coupons yet'}
                description={
                  filtered
                    ? 'Clear the filters or try another search.'
                    : 'Create your first discount code or automatic promotion.'
                }
                action={
                  filtered ? undefined : (
                    <Button asChild>
                      <Link to="/admin/coupons/new">New coupon</Link>
                    </Button>
                  )
                }
              />
            }
          />
          <Pagination
            className="mt-4"
            page={page}
            pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            onPageChange={setPage}
          />
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        title={`Delete ${deleting?.code ?? 'coupon'}?`}
        description={
          deleting && deleting.times_redeemed > 0
            ? 'This coupon has been redeemed, so it cannot be deleted. Deactivate it instead to keep the history.'
            : 'This permanently removes the coupon. This cannot be undone.'
        }
        confirmLabel="Delete coupon"
        tone="danger"
        loading={del.isPending || toggle.isPending}
        error={deleteError}
        onConfirm={async () => {
          if (!deleting) return;
          setDeleteError(null);
          try {
            await del.mutateAsync(deleting.id);
            toast.success(`${deleting.code} was deleted.`);
            setDeleting(null);
          } catch (e) {
            setDeleteError(isApiError(e) ? e.message : describeError(e).message);
          }
        }}
      >
        {deleting && (deleteError || deleting.times_redeemed > 0) && deleting.is_active ? (
          <Button
            variant="secondary"
            size="sm"
            loading={toggle.isPending}
            onClick={async () => {
              await flip(deleting);
              setDeleting(null);
            }}
          >
            Deactivate instead
          </Button>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
