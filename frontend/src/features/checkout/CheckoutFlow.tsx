import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuth } from '@/app/auth';
import { CouponBox } from '@/features/cart/components/CouponBox';
import { CHOICE_CODES, IssueList } from '@/features/cart/components/IssueList';
import { useAddresses } from '@/lib/api/account';
import { useBranches } from '@/lib/api/branches';
import {
  checkoutApi,
  usePaymentMethods,
  usePreview,
  type CartPreview,
  type CheckoutPayload,
  type PreviewRequest,
} from '@/lib/api/checkout';
import { qk } from '@/lib/api/keys';
import type { Branch, CartIssue } from '@/lib/api/types';
import { AddressStep } from './components/AddressStep';
import { DetailsStep } from './components/DetailsStep';
import { BranchStep, OrderTypeStep, branchProblem } from './components/FulfilmentSteps';
import { OrderSummary, type FulfilmentLine } from './components/OrderSummary';
import { PaymentStep } from './components/PaymentStep';
import { PlaceErrorAlert } from './components/PlaceErrorAlert';
import { PriceChangedDialog } from './components/PriceChangedDialog';
import { StepCard } from './components/StepCard';
import { TimeStep, type Timing } from './components/TimeStep';
import { attemptKeyFor, clearAttemptKey } from './idempotency';
import { resolvePaymentAction } from './paymentAction';
import {
  classifyPlaceError,
  stepForIssue,
  type ErrorSlot,
  type PlaceError,
  type StepId,
} from './placeError';
import { useCheckoutSelection } from './selection';

type StepErrors = Partial<Record<ErrorSlot, string>>;

function formatWhen(iso: string | null | undefined, timeZone: string | undefined) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return format(new Date(iso), 'EEE d MMM p');
  }
}

/** Focus a step's heading so keyboard/screen-reader users land on the problem. */
function focusStep(step: StepId) {
  const heading = document.getElementById(`step-${step}-title`);
  if (!heading) return;
  heading.scrollIntoView({ block: 'center' });
  heading.focus({ preventScroll: true });
}

const STEP_ORDER: StepId[] = ['type', 'branch', 'address', 'time', 'coupon', 'payment', 'details'];

/**
 * The signed-in checkout: seven always-visible steps and a live server-priced summary. All money shown here
 * comes from `cart/preview/`; the order payload carries choices and the displayed total, never prices.
 */
export default function CheckoutFlow() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const selection = useCheckoutSelection();
  const { orderType, branchSlug, couponCode, setOrderType, setBranchSlug, setCouponCode } =
    selection;

  const branches = useBranches();
  const addresses = useAddresses();
  const methods = usePaymentMethods();

  const [addressId, setAddressId] = useState<number | null>(null);
  const [timing, setTiming] = useState<Timing>({ mode: 'asap' });
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [stepErrors, setStepErrors] = useState<StepErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [placeError, setPlaceError] = useState<PlaceError | null>(null);
  const [placing, setPlacing] = useState(false);
  const [changedFrom, setChangedFrom] = useState<string | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const delivery = orderType === 'DELIVERY';
  const branch: Branch | undefined = branches.data?.find((b) => b.slug === branchSlug);

  // A stored branch that no longer exists / cannot take this order type is replaced by the first one that can.
  useEffect(() => {
    if (!branches.data) return;
    const valid = branches.data.find((b) => b.slug === branchSlug && !branchProblem(b, orderType));
    if (valid) return;
    const fallback =
      branches.data.find((b) => !branchProblem(b, orderType) && b.is_open_now) ??
      branches.data.find((b) => !branchProblem(b, orderType));
    setBranchSlug(fallback?.slug ?? null);
  }, [branches.data, branchSlug, orderType, setBranchSlug]);

  // Default the delivery address: keep a valid choice, else the default address, else the first.
  useEffect(() => {
    if (!delivery || !addresses.data) return;
    if (addressId && addresses.data.some((a) => a.id === addressId)) return;
    const next = addresses.data.find((a) => a.is_default) ?? addresses.data[0];
    setAddressId(next?.id ?? null);
  }, [delivery, addresses.data, addressId]);

  const requestedFor = timing.mode === 'scheduled' ? timing.startsAt : null;
  const previewRequest = useMemo<PreviewRequest>(
    () => ({
      order_type: orderType,
      branch_id: branch?.id ?? null,
      address_id: delivery ? addressId : null,
      coupon_code: couponCode || undefined,
      requested_for: requestedFor,
    }),
    [orderType, branch?.id, delivery, addressId, couponCode, requestedFor],
  );
  const preview = usePreview(previewRequest);
  const previewData: CartPreview | undefined = preview.data;
  const settled = Boolean(previewData) && !preview.isFetching;

  const clearStepError = (step: ErrorSlot) =>
    setStepErrors((prev) => {
      if (!prev[step]) return prev;
      const { [step]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });

  // Server blockers, split into choices still to make vs. real problems.
  const blockers: CartIssue[] = previewData?.checkout_blockers ?? [];
  const problems = blockers.filter((b) => !CHOICE_CODES.has(b.code));
  const itemProblems = problems.filter((b) => stepForIssue(b) === null);
  const stepProblem = (step: StepId) =>
    problems
      .filter((b) => stepForIssue(b) === step)
      .map((b) => b.message)
      .join(' ') || undefined;
  const choiceProblem = (step: StepId) =>
    attempted
      ? blockers
          .filter((b) => CHOICE_CODES.has(b.code) && stepForIssue(b) === step)
          .map((b) => b.message)
          .join(' ') || undefined
      : undefined;
  const errorFor = (step: StepId) => stepErrors[step] ?? stepProblem(step) ?? choiceProblem(step);

  const validate = (): StepErrors => {
    const errors: StepErrors = {};
    if (!branch) errors.branch = 'Choose a location for your order.';
    if (delivery && !addressId) errors.address = 'Choose a delivery address.';
    if (timing.mode === 'scheduled' && !timing.startsAt)
      errors.time = 'Choose a time, or pick "As soon as possible".';
    if (!paymentMethod) errors.payment = 'Choose how you would like to pay.';
    if (!acceptTerms)
      errors.terms = 'Please accept the Terms and Refund Policy to place your order.';
    return errors;
  };

  const submit = useCallback(
    async (expectedOverride?: string) => {
      if (inFlight.current) return;
      setAttempted(true);
      const errors = validate();
      const firstMissing = STEP_ORDER.find((s) =>
        s === 'details'
          ? Boolean(errors.terms ?? errors.phone ?? errors.notes)
          : Boolean(errors[s]),
      );
      if (firstMissing || !branch || !paymentMethod) {
        setStepErrors(errors);
        setPlaceError(null);
        if (firstMissing) focusStep(firstMissing);
        return;
      }
      const payload: CheckoutPayload = {
        branch_id: branch.id,
        order_type: orderType,
        ...(delivery ? { address_id: addressId } : {}),
        requested_for: requestedFor,
        coupon_code: couponCode,
        payment_method: paymentMethod,
        customer_notes: notes.trim(),
        accept_terms: acceptTerms,
        expected_total: expectedOverride ?? previewData?.total ?? null,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      };
      inFlight.current = true;
      const sentTotal = payload.expected_total ?? null;
      setPlacing(true);
      setStepErrors({});
      setPlaceError(null);
      try {
        const key = attemptKeyFor(payload);
        const result = await checkoutApi.place(payload, key);
        clearAttemptKey();
        setCouponCode('');
        const { order, payment } = result;
        const action = resolvePaymentAction(payment.action);
        if (action.kind === 'external') {
          window.location.assign(action.url);
          return;
        }
        if (action.kind === 'internal') navigate(action.to, { replace: true });
        else if (payment.error)
          navigate(`/orders/${order.number}`, {
            replace: true,
            state: { paymentError: payment.error.message },
          });
        else navigate(`/orders/${order.number}/confirmation`, { replace: true });
        void qc.invalidateQueries({ queryKey: qk.cart });
        void qc.invalidateQueries({ queryKey: qk.orders.all });
      } catch (e) {
        const classified = classifyPlaceError(e);
        setPlaceError(classified);
        if (classified.kind === 'price_changed' && classified.preview) {
          setChangedFrom(sentTotal);
          qc.setQueryData([...qk.cart, 'preview', previewRequest], classified.preview);
        }
        if (classified.kind === 'step') {
          setStepErrors(classified.fields);
          focusStep(classified.step);
        } else if (classified.kind !== 'price_changed') {
          window.setTimeout(() => errorRef.current?.focus(), 0);
        }
        if (classified.kind === 'out_of_stock' || classified.kind === 'step') {
          void qc.invalidateQueries({ queryKey: qk.cart });
        }
      } finally {
        inFlight.current = false;
        setPlacing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      branch,
      paymentMethod,
      orderType,
      delivery,
      addressId,
      requestedFor,
      couponCode,
      notes,
      acceptTerms,
      phone,
      previewData?.total,
      previewRequest,
      timing,
      setCouponCode,
    ],
  );

  const when =
    timing.mode === 'scheduled'
      ? (formatWhen(timing.startsAt, branch?.timezone) ?? 'Choose a time')
      : previewData?.estimated_ready_at
        ? `ASAP · around ${formatWhen(previewData.estimated_ready_at, branch?.timezone)}`
        : 'As soon as possible';
  const address = addresses.data?.find((a) => a.id === addressId);
  const methodLabel = methods.data?.find((m) => m.key === paymentMethod)?.label;
  const lines: FulfilmentLine[] = [
    { label: 'Order type', value: delivery ? 'Delivery' : 'Pickup' },
    { label: delivery ? 'Prepared at' : 'Pickup at', value: branch?.name ?? 'Not chosen yet' },
    ...(delivery
      ? [
          {
            label: 'Deliver to',
            value: address ? `${address.line1}, ${address.city}` : 'Not chosen yet',
          },
        ]
      : []),
    { label: delivery ? 'Arrival' : 'Ready', value: when },
    ...(methodLabel ? [{ label: 'Payment', value: methodLabel }] : []),
  ];

  // Focus the step after the customer fixes a broken choice? No: keep focus where they are. Only errors steal it.
  const steps: Array<{ id: StepId; title: string; description?: string }> = [
    { id: 'type', title: 'Pickup or delivery' },
    { id: 'branch', title: 'Location', description: 'Where your order is prepared.' },
    ...(delivery ? [{ id: 'address' as StepId, title: 'Delivery address' }] : []),
    { id: 'time', title: 'When', description: 'Now, or choose a time up to 7 days ahead.' },
    { id: 'coupon', title: 'Promo code' },
    { id: 'payment', title: 'Payment' },
    { id: 'details', title: 'Details and terms' },
  ];
  const number = (id: StepId) => steps.findIndex((s) => s.id === id) + 1;
  const meta = (id: StepId) => steps.find((s) => s.id === id)!;

  const onTypeChange = (type: typeof orderType) => {
    // A branch that cannot do the new type is swapped for one that can, before the type changes.
    if (branches.data && (!branch || branchProblem(branch, type))) {
      const alt = branches.data.find((b) => !branchProblem(b, type));
      if (alt) setBranchSlug(alt.slug);
    }
    setOrderType(type);
    setTiming({ mode: 'asap' });
    setPlaceError(null);
    setStepErrors({});
  };
  const onBranchChange = (slug: string) => {
    setBranchSlug(slug);
    setTiming({ mode: 'asap' });
    setPlaceError(null);
    clearStepError('branch');
    clearStepError('time');
  };

  const canPlace = settled && !placing && problems.length === 0;
  const hint = !previewData
    ? 'Working out your total…'
    : preview.isFetching
      ? 'Updating your total…'
      : problems.length > 0
        ? 'Fix the highlighted problems to place your order.'
        : undefined;

  const priceChanged = placeError?.kind === 'price_changed' ? placeError : null;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12">
      <div className="grid gap-5 pb-28 lg:pb-0">
        <PlaceErrorAlert ref={errorRef} error={placeError} />
        {itemProblems.length > 0 ? (
          <IssueList issues={itemProblems} title="Some items need attention" />
        ) : null}

        <StepCard
          id="type"
          number={number('type')}
          title={meta('type').title}
          complete
          error={errorFor('type')}
        >
          <OrderTypeStep value={orderType} onChange={onTypeChange} />
        </StepCard>

        <StepCard
          id="branch"
          number={number('branch')}
          title={meta('branch').title}
          description={meta('branch').description}
          complete={Boolean(branch)}
          error={errorFor('branch')}
        >
          <BranchStep
            branches={branches.data}
            loading={branches.isPending}
            value={branchSlug}
            orderType={orderType}
            onChange={onBranchChange}
          />
        </StepCard>

        {delivery ? (
          <StepCard
            id="address"
            number={number('address')}
            title={meta('address').title}
            complete={Boolean(addressId)}
            error={errorFor('address')}
          >
            <AddressStep
              addresses={addresses.data}
              loading={addresses.isPending}
              value={addressId}
              branchSlug={branchSlug}
              onChange={(id) => {
                setAddressId(id);
                clearStepError('address');
              }}
            />
          </StepCard>
        ) : null}

        <StepCard
          id="time"
          number={number('time')}
          title={meta('time').title}
          description={meta('time').description}
          complete={timing.mode === 'asap' || Boolean(timing.startsAt)}
          error={errorFor('time')}
        >
          <TimeStep
            branchSlug={branchSlug}
            orderType={orderType}
            value={timing}
            onChange={(t) => {
              setTiming(t);
              clearStepError('time');
            }}
          />
        </StepCard>

        <StepCard
          id="coupon"
          number={number('coupon')}
          title={meta('coupon').title}
          complete={Boolean(previewData?.coupon)}
          error={errorFor('coupon')}
        >
          <CouponBox
            code={couponCode}
            orderType={orderType}
            branchId={branch?.id}
            preview={previewData}
            onApply={(code) => {
              setCouponCode(code);
              clearStepError('coupon');
            }}
            onRemove={() => {
              setCouponCode('');
              clearStepError('coupon');
            }}
          />
        </StepCard>

        <StepCard
          id="payment"
          number={number('payment')}
          title={meta('payment').title}
          complete={Boolean(paymentMethod)}
          error={errorFor('payment')}
        >
          <PaymentStep
            value={paymentMethod}
            orderType={orderType}
            onChange={(key) => {
              setPaymentMethod(key);
              clearStepError('payment');
            }}
          />
        </StepCard>

        <StepCard
          id="details"
          number={number('details')}
          title={meta('details').title}
          complete={acceptTerms}
        >
          <DetailsStep
            notes={notes}
            phone={phone}
            acceptTerms={acceptTerms}
            notesError={stepErrors.notes}
            phoneError={stepErrors.phone}
            termsError={stepErrors.terms}
            onNotes={(v) => {
              setNotes(v);
              clearStepError('notes');
            }}
            onPhone={(v) => {
              setPhone(v);
              clearStepError('phone');
            }}
            onAcceptTerms={(v) => {
              setAcceptTerms(v);
              clearStepError('terms');
            }}
          />
        </StepCard>
      </div>

      <OrderSummary
        preview={previewData}
        loading={preview.isPending}
        failed={preview.isError && !previewData}
        onRetry={() => void preview.refetch()}
        lines={lines}
        hint={hint}
        placing={placing}
        canPlace={canPlace}
        onPlace={() => void submit()}
      />

      <PriceChangedDialog
        open={Boolean(priceChanged)}
        previousTotal={changedFrom ?? undefined}
        preview={priceChanged?.preview ?? null}
        busy={placing}
        onReview={() => setPlaceError(null)}
        onAccept={() => {
          const next = priceChanged?.preview?.total;
          if (next) void submit(next);
        }}
      />
    </div>
  );
}
