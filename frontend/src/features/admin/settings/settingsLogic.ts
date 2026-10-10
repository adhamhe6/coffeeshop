import { z } from 'zod';
import type { AdminStoreSettings, StoreSettingsPatch } from '@/lib/api/peopleTypes';

export interface SettingsValues {
  brand_name: string;
  tagline: string;
  legal_name: string;
  support_email: string;
  support_phone: string;
  business_address: string;
  currency: string;
  tax_rate: string;
  tax_label: string;
  prices_include_tax: boolean;
  auto_confirm_paid_orders: boolean;
  enable_reviews: boolean;
  allowed_checkout_methods: string[];
  /** UI only, never sent. Required when tax or currency settings change. */
  tax_confirmed: boolean;
}

export function settingsToValues(s: AdminStoreSettings): SettingsValues {
  return {
    brand_name: s.brand_name,
    tagline: s.tagline,
    legal_name: s.legal_name,
    support_email: s.support_email,
    support_phone: s.support_phone,
    business_address: s.business_address,
    currency: s.currency,
    tax_rate: String(Number(s.tax_rate)),
    tax_label: s.tax_label,
    prices_include_tax: s.prices_include_tax,
    auto_confirm_paid_orders: s.auto_confirm_paid_orders,
    enable_reviews: s.enable_reviews,
    // Only methods this server can actually run are selectable; others are reported separately.
    allowed_checkout_methods: s.allowed_checkout_methods.filter((m) =>
      s.available_checkout_methods.includes(m),
    ),
    tax_confirmed: false,
  };
}

/** Settings whose change needs an explicit "I checked the legal requirements" confirmation. */
export function taxFieldsChanged(saved: SettingsValues, next: SettingsValues): boolean {
  return (
    Number(saved.tax_rate) !== Number(next.tax_rate) ||
    saved.tax_label.trim() !== next.tax_label.trim() ||
    saved.prices_include_tax !== next.prices_include_tax ||
    saved.currency.trim().toUpperCase() !== next.currency.trim().toUpperCase()
  );
}

export const makeSettingsSchema = (saved: SettingsValues) =>
  z
    .object({
      brand_name: z
        .string()
        .trim()
        .min(1, 'Enter your brand name.')
        .max(80, 'Keep it under 80 characters.'),
      tagline: z.string().trim().max(160, 'Keep it under 160 characters.'),
      legal_name: z.string().trim().max(160, 'Keep it under 160 characters.'),
      support_email: z
        .string()
        .trim()
        .max(254)
        .refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email address.'),
      support_phone: z.string().trim().max(40, 'Keep it under 40 characters.'),
      business_address: z.string().trim().max(500, 'Keep it under 500 characters.'),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code such as USD.'),
      tax_rate: z
        .string()
        .trim()
        .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v), 'Enter a percentage like 8 or 8.25.')
        .refine((v) => Number(v) <= 100, 'A tax rate cannot be more than 100%.'),
      tax_label: z
        .string()
        .trim()
        .min(1, 'Enter the label shown on receipts, e.g. Sales tax.')
        .max(30, 'Keep it under 30 characters.'),
      prices_include_tax: z.boolean(),
      auto_confirm_paid_orders: z.boolean(),
      enable_reviews: z.boolean(),
      allowed_checkout_methods: z
        .array(z.string())
        .min(1, 'Keep at least one payment method switched on, or customers cannot check out.'),
      tax_confirmed: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (taxFieldsChanged(saved, v as SettingsValues) && !v.tax_confirmed) {
        ctx.addIssue({
          code: 'custom',
          path: ['tax_confirmed'],
          message: 'Confirm that these tax and currency settings meet your legal requirements.',
        });
      }
    });

/** Only fields that changed, as a PATCH body (decimals as strings, currency upper-cased). */
export function diffSettings(saved: SettingsValues, next: SettingsValues): StoreSettingsPatch {
  const patch: StoreSettingsPatch = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const text = [
    'brand_name',
    'tagline',
    'legal_name',
    'support_email',
    'support_phone',
    'business_address',
    'tax_label',
  ] as const;
  for (const k of text) if (saved[k].trim() !== next[k].trim()) patch[k] = next[k].trim();
  if (saved.currency.trim().toUpperCase() !== next.currency.trim().toUpperCase())
    patch.currency = next.currency.trim().toUpperCase();
  if (Number(saved.tax_rate) !== Number(next.tax_rate))
    patch.tax_rate = Number(next.tax_rate).toFixed(2);
  const bools = ['prices_include_tax', 'auto_confirm_paid_orders', 'enable_reviews'] as const;
  for (const k of bools) if (saved[k] !== next[k]) patch[k] = next[k];
  if (!same([...saved.allowed_checkout_methods].sort(), [...next.allowed_checkout_methods].sort()))
    patch.allowed_checkout_methods = next.allowed_checkout_methods;
  return patch;
}
