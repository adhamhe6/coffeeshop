import { CircleCheckBig, CircleSlash, FlaskConical } from 'lucide-react';
import { Badge, Checkbox, Skeleton } from '@/design';
import { usePaymentMethods } from '@/lib/api/adminSettings';
import type { PaymentMethodInfo } from '@/lib/api/peopleTypes';

const KNOWN_PROVIDERS: Record<string, string> = {
  stripe: 'Card payments (Stripe)',
  demo: 'Sandbox payment',
  cash: 'Pay at pickup / on delivery',
};

interface Props {
  /** Provider keys this server can run (from `admin/settings/`). */
  available: string[];
  /** What the saved settings list, including keys that are not currently available. */
  saved: string[];
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}

/**
 * Checkout methods: only providers enabled on the server can be ticked. Providers the server cannot run are listed
 * honestly below (e.g. Stripe without API keys) instead of being offered and failing at checkout.
 */
export function PaymentMethodsField({ available, saved, value, onChange, error }: Props) {
  const methods = usePaymentMethods();
  const byKey = new Map<string, PaymentMethodInfo>((methods.data ?? []).map((m) => [m.key, m]));
  const unavailable = Object.keys(KNOWN_PROVIDERS).filter((k) => !available.includes(k));
  const droppedOnSave = saved.filter((k) => !available.includes(k));
  const hasSandbox = value.some((k) => byKey.get(k)?.is_sandbox);

  return (
    <fieldset className="grid gap-3" aria-describedby="payment-methods-help">
      <legend className="text-sm font-medium">Payment methods offered at checkout</legend>
      <p id="payment-methods-help" className="text-sm text-text-muted">
        Only methods the server has switched on can be offered. Customers pick from the ticked ones.
      </p>
      {methods.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="grid gap-3 rounded-md border border-border-strong p-3">
          {available.map((key) => {
            const info = byKey.get(key);
            return (
              <Checkbox
                key={key}
                label={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {info?.label ?? KNOWN_PROVIDERS[key] ?? key}
                    {info?.is_sandbox ? (
                      <Badge tone="warning" size="sm">
                        <FlaskConical aria-hidden="true" />
                        Sandbox — no real money
                      </Badge>
                    ) : null}
                    {info?.offline ? (
                      <Badge tone="outline" size="sm">
                        Paid in person
                      </Badge>
                    ) : null}
                  </span>
                }
                description={info?.description}
                checked={value.includes(key)}
                onCheckedChange={(c) =>
                  onChange(c === true ? [...value, key] : value.filter((k) => k !== key))
                }
              />
            );
          })}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {hasSandbox ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          The sandbox method simulates payments for testing. Switch it off before taking real
          orders.
        </p>
      ) : null}

      <div
        className="rounded-md bg-surface-sunken p-3 text-sm"
        aria-label="Payment providers on this server"
      >
        <p className="font-medium">Payment providers on this server</p>
        <ul className="mt-2 grid gap-1.5">
          {available.map((k) => (
            <li key={k} className="flex items-center gap-2">
              <CircleCheckBig aria-hidden="true" className="size-4 text-success" />
              <span>
                {KNOWN_PROVIDERS[k] ?? k}: <strong>enabled</strong>
              </span>
            </li>
          ))}
          {unavailable.map((k) => (
            <li key={k} className="flex items-start gap-2 text-text-muted">
              <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {KNOWN_PROVIDERS[k]}: <strong>not enabled</strong>
                {k === 'stripe'
                  ? '. Stripe needs its secret and webhook keys set on the server (by whoever hosts the site); it cannot be switched on from this page.'
                  : '.'}
              </span>
            </li>
          ))}
        </ul>
        {droppedOnSave.length > 0 ? (
          <p className="mt-2 text-text-muted">
            Saved in your settings but unavailable here: {droppedOnSave.join(', ')}. They stay saved
            until you change the payment methods above; then they are removed from the list.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
