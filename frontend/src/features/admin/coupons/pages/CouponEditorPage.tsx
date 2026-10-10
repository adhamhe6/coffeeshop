import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Trash2 } from 'lucide-react';
import { Button, ErrorState, Money, Skeleton, toast } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useAdminCoupon, useDeleteCoupon, useToggleCoupon } from '@/lib/api/adminMarketing';
import { describeError, isApiError } from '@/lib/api/errors';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { useStoreTimeZone } from '../../people-kit/useStoreTimeZone';
import { CouponForm } from '../components/CouponForm';
import { BLANK_COUPON, couponToForm } from '../couponLogic';

/** `/admin/coupons/new` (optionally `?clone=<id>`) and `/admin/coupons/:id`. */
export default function CouponEditorPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const cloneId = search.get('clone') ?? undefined;
  const sourceId = id ?? cloneId;
  const query = useAdminCoupon(sourceId);
  const { timeZone } = useStoreTimeZone();
  const isNew = !id;
  const title = isNew ? (cloneId ? 'Clone coupon' : 'New coupon') : 'Edit coupon';
  useSeo({ title, noindex: true });

  const back = { to: '/admin/coupons', label: 'All coupons' };

  if (sourceId && query.isPending) {
    return (
      <div aria-busy="true" className="grid gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (sourceId && (query.isError || !query.data)) {
    return (
      <div>
        <AdminPageHeader title={title} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const coupon = query.data;
  const editing = !isNew && coupon ? coupon : undefined;
  return (
    <div>
      <AdminPageHeader
        title={editing ? `Edit ${editing.code}` : title}
        back={back}
        description={
          editing ? (
            <>
              Redeemed {editing.redemption_count} time{editing.redemption_count === 1 ? '' : 's'},
              giving <Money value={editing.total_discount} /> in discounts so far.
            </>
          ) : cloneId ? (
            'Copied from an existing coupon. Choose a new code before saving.'
          ) : (
            'Set up a code or an automatic promotion. You can preview how it reads before saving.'
          )
        }
        actions={
          editing ? (
            <DangerActions
              couponId={editing.id}
              code={editing.code}
              redeemed={editing.times_redeemed}
              isActive={editing.is_active}
            />
          ) : null
        }
      />
      <CouponForm
        key={editing?.id ?? cloneId ?? 'new'}
        heading={title}
        coupon={editing}
        initial={coupon ? couponToForm(coupon, timeZone, { clone: isNew }) : BLANK_COUPON}
      />
    </div>
  );
}

function DangerActions({
  couponId,
  code,
  redeemed,
  isActive,
}: {
  couponId: number;
  code: string;
  redeemed: number;
  isActive: boolean;
}) {
  const navigate = useNavigate();
  const del = useDeleteCoupon();
  const toggle = useToggleCoupon();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsDeactivate, setNeedsDeactivate] = useState(false);

  const deactivate = async () => {
    try {
      await toggle.mutateAsync({ id: couponId, is_active: false });
      toast.success(`${code} was deactivated.`);
      setOpen(false);
      navigate('/admin/coupons');
    } catch (e) {
      setError(isApiError(e) ? e.message : describeError(e).message);
    }
  };

  return (
    <>
      {isActive && redeemed > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          loading={toggle.isPending}
          onClick={() => void deactivate()}
        >
          Deactivate
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
        onClick={() => {
          setError(null);
          setNeedsDeactivate(false);
          setOpen(true);
        }}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${code}?`}
        description={
          redeemed > 0
            ? 'This coupon has been redeemed, so it cannot be deleted. Deactivate it instead to keep the history.'
            : 'This permanently removes the coupon. It has never been redeemed.'
        }
        confirmLabel="Delete coupon"
        tone="danger"
        loading={del.isPending || toggle.isPending}
        error={error}
        onConfirm={async () => {
          setError(null);
          try {
            await del.mutateAsync(couponId);
            toast.success(`${code} was deleted.`);
            setOpen(false);
            navigate('/admin/coupons');
          } catch (e) {
            if (isApiError(e) && e.code === 'coupon_has_redemptions') setNeedsDeactivate(true);
            setError(isApiError(e) ? e.message : describeError(e).message);
          }
        }}
      >
        {needsDeactivate || redeemed > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            loading={toggle.isPending}
            onClick={() => void deactivate()}
          >
            Deactivate instead
          </Button>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
