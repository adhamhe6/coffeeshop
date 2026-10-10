import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface MoneyFormatter {
  currency: string;
  locale: string;
  /** Format a decimal string/number (API money is a string like "4.50"). */
  format: (value: string | number | null | undefined, opts?: { signed?: boolean }) => string;
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatterFor(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency });
    } catch {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
    }
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(
  value: string | number | null | undefined,
  currency: string,
  locale = 'en-US',
  opts: { signed?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const text = formatterFor(locale, currency).format(n);
  return opts.signed && n > 0 ? `+${text}` : text;
}

export function makeMoneyFormatter(currency: string, locale = 'en-US'): MoneyFormatter {
  return { currency, locale, format: (v, o) => formatMoney(v, currency, locale, o) };
}

const MoneyContext = createContext<MoneyFormatter>(makeMoneyFormatter('USD'));

export function MoneyProvider({
  currency,
  locale,
  children,
}: {
  currency: string;
  locale?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => makeMoneyFormatter(currency, locale), [currency, locale]);
  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

/** Currency-aware formatter backed by the store currency (see MoneyProvider in AppProviders). */
export function useMoney(): MoneyFormatter {
  return useContext(MoneyContext);
}

interface MoneyProps {
  value: string | number | null | undefined;
  /** Prefix positive numbers with "+" (option price deltas). */
  signed?: boolean;
  className?: string;
}

/** `<Money value="12.5" />` → `$12.50`. Uses tabular numerals so columns align. */
export function Money({ value, signed, className }: MoneyProps) {
  const { format } = useMoney();
  return <span className={cn('tabular-nums', className)}>{format(value, { signed })}</span>;
}
