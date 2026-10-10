import { z } from 'zod';
import type { AdminProduct, AdminProductInput, StockMode } from '@/lib/api/adminCatalog';
import type { ProductType } from '@/lib/api/types';

/**
 * Form model, validation and payload shaping for the product editor.
 * Money stays a decimal STRING ("4.50") from the input to the request; nothing here does float arithmetic on prices.
 */

export interface NutritionRow {
  key: string;
  value: string;
}

export interface ProductFormValues {
  name: string;
  slug: string;
  sku: string;
  category: string;
  product_type: ProductType;
  stock_mode: StockMode;
  short_description: string;
  description: string;
  base_price: string;
  is_active: boolean;
  is_featured: boolean;
  is_bestseller: boolean;
  is_seasonal: boolean;
  is_new: boolean;
  is_sold_out: boolean;
  prep_minutes: string;
  calories: string;
  caffeine_mg: string;
  allergens: string[];
  tags: string[];
  nutrition: NutritionRow[];
  modifier_group_ids: number[];
  collection_ids: number[];
}

export const PRICE_PATTERN = /^\d{1,6}(\.\d{1,2})?$/;

/** "4.5" → "4.50", "4" → "4.00"; null when it is not a valid price (max 6 integer digits, 2 decimals). */
export function normalisePrice(raw: string): string | null {
  const value = raw.trim();
  if (!PRICE_PATTERN.test(value)) return null;
  const [whole = '0', frac = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${frac.padEnd(2, '0')}`;
}

/** URL-safe suggestion for the slug field: "Café Crème (Iced)" → "cafe-creme-iced". */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}

export const nutritionKey = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const optionalInt = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), `${label} must be a whole number, 0 or more.`)
    .refine((v) => v === '' || Number(v) <= max, `${label} must be ${max} or less.`);

export const productSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(120, 'Keep the name under 120 characters.'),
    slug: z
      .string()
      .trim()
      .max(140, 'Keep the slug under 140 characters.')
      .regex(/^[-a-zA-Z0-9_]*$/, 'Use letters, numbers, hyphens and underscores only.'),
    sku: z.string().trim().min(1, 'Enter a SKU.').max(40, 'Keep the SKU under 40 characters.'),
    category: z.string().min(1, 'Choose a category.'),
    product_type: z.enum(['BEVERAGE', 'FOOD', 'BEANS', 'MERCH', 'GIFT']),
    stock_mode: z.enum(['PREPARED', 'STOCKED']),
    short_description: z.string().max(200, 'Keep the summary under 200 characters.'),
    description: z.string(),
    base_price: z
      .string()
      .trim()
      .min(1, 'Enter a price.')
      .refine(
        (v) => v === '' || normalisePrice(v) !== null,
        'Enter a price like 4.50 (up to 2 decimals).',
      ),
    is_active: z.boolean(),
    is_featured: z.boolean(),
    is_bestseller: z.boolean(),
    is_seasonal: z.boolean(),
    is_new: z.boolean(),
    is_sold_out: z.boolean(),
    prep_minutes: optionalInt('Preparation time', 32767),
    calories: optionalInt('Calories', 2_000_000_000),
    caffeine_mg: optionalInt('Caffeine', 2_000_000_000),
    allergens: z.array(z.string()).max(20, 'At most 20 allergens.'),
    tags: z.array(z.string()).max(30, 'At most 30 tags.'),
    nutrition: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .max(20, 'At most 20 nutrition entries.'),
    modifier_group_ids: z.array(z.number()),
    collection_ids: z.array(z.number()),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.nutrition.forEach((row, i) => {
      const key = nutritionKey(row.key);
      const value = row.value.trim();
      if (!key && !value) return;
      if (!key) {
        ctx.addIssue({
          code: 'custom',
          path: ['nutrition', i, 'key'],
          message: 'Name this entry.',
        });
        return;
      }
      if (!value) {
        ctx.addIssue({
          code: 'custom',
          path: ['nutrition', i, 'value'],
          message: 'Enter a value.',
        });
      } else if (value.length > 40) {
        ctx.addIssue({
          code: 'custom',
          path: ['nutrition', i, 'value'],
          message: 'Keep values under 40 characters.',
        });
      } else if (!Number.isNaN(Number(value)) && (Number(value) < 0 || Number(value) > 100000)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nutrition', i, 'value'],
          message: 'Numbers must be between 0 and 100000.',
        });
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nutrition', i, 'key'],
          message: 'Each name can only appear once.',
        });
      }
      seen.add(key);
    });
  });

export const EMPTY_PRODUCT: ProductFormValues = {
  name: '',
  slug: '',
  sku: '',
  category: '',
  product_type: 'BEVERAGE',
  stock_mode: 'PREPARED',
  short_description: '',
  description: '',
  base_price: '',
  is_active: true,
  is_featured: false,
  is_bestseller: false,
  is_seasonal: false,
  is_new: false,
  is_sold_out: false,
  prep_minutes: '5',
  calories: '',
  caffeine_mg: '',
  allergens: [],
  tags: [],
  nutrition: [],
  modifier_group_ids: [],
  collection_ids: [],
};

export function fromProduct(p: AdminProduct, collectionIds: number[] = []): ProductFormValues {
  return {
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    category: String(p.category),
    product_type: p.product_type,
    stock_mode: p.stock_mode,
    short_description: p.short_description,
    description: p.description,
    base_price: p.base_price,
    is_active: p.is_active,
    is_featured: p.is_featured,
    is_bestseller: p.is_bestseller,
    is_seasonal: p.is_seasonal,
    is_new: p.is_new,
    is_sold_out: p.is_sold_out,
    prep_minutes: String(p.prep_minutes),
    calories: p.calories === null ? '' : String(p.calories),
    caffeine_mg: p.caffeine_mg === null ? '' : String(p.caffeine_mg),
    allergens: [...p.allergens],
    tags: [...p.tags],
    nutrition: Object.entries(p.nutrition ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    modifier_group_ids: [...p.modifier_group_ids],
    collection_ids: [...collectionIds],
  };
}

const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

/**
 * Request body for the product API. Prices are normalised decimal strings, nested group ids keep their order,
 * nutrition becomes `{lower_snake_key: number | text}`. `collection_ids` is not part of the product payload (it is
 * synced through the collections API), so it is left out.
 */
export function toPayload(v: ProductFormValues): AdminProductInput {
  const nutrition: Record<string, string | number> = {};
  for (const row of v.nutrition) {
    const key = nutritionKey(row.key);
    const value = row.value.trim();
    if (!key || !value) continue;
    nutrition[key] = !Number.isNaN(Number(value)) ? Number(value) : value;
  }
  const payload: AdminProductInput = {
    name: v.name.trim(),
    sku: v.sku.trim(),
    category: Number(v.category),
    product_type: v.product_type,
    stock_mode: v.stock_mode,
    short_description: v.short_description.trim(),
    description: v.description,
    base_price: normalisePrice(v.base_price) ?? v.base_price.trim(),
    is_active: v.is_active,
    is_featured: v.is_featured,
    is_bestseller: v.is_bestseller,
    is_seasonal: v.is_seasonal,
    is_new: v.is_new,
    is_sold_out: v.is_sold_out,
    calories: intOrNull(v.calories),
    caffeine_mg: intOrNull(v.caffeine_mg),
    allergens: v.allergens,
    nutrition,
    tags: v.tags,
    modifier_group_ids: v.modifier_group_ids,
  };
  if (v.prep_minutes.trim() !== '') payload.prep_minutes = Number(v.prep_minutes);
  // An empty slug on create asks the server to generate a unique one.
  if (v.slug.trim()) payload.slug = v.slug.trim().toLowerCase();
  return payload;
}

/** Only the keys whose value differs from `original` (PATCH body: concurrent edits to other fields survive). */
export function changedPayload(
  next: AdminProductInput,
  original: AdminProductInput,
): AdminProductInput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(value) !== JSON.stringify((original as Record<string, unknown>)[key])) {
      out[key] = value;
    }
  }
  return out as AdminProductInput;
}

/** Form fields the server can attach an error to (everything else becomes a form-level alert). */
export const PRODUCT_SERVER_FIELDS = [
  'name',
  'slug',
  'sku',
  'category',
  'product_type',
  'stock_mode',
  'short_description',
  'description',
  'base_price',
  'prep_minutes',
  'calories',
  'caffeine_mg',
  'allergens',
  'tags',
  'nutrition',
  'modifier_group_ids',
] as const;

/** Which editor section a field belongs to (to open/scroll to the first error). */
export const FIELD_SECTION: Record<string, string> = {
  name: 'basics',
  slug: 'basics',
  sku: 'basics',
  category: 'basics',
  product_type: 'basics',
  short_description: 'basics',
  description: 'basics',
  base_price: 'pricing',
  modifier_group_ids: 'options',
  tags: 'merchandising',
  allergens: 'details',
  nutrition: 'details',
  calories: 'details',
  caffeine_mg: 'details',
  prep_minutes: 'details',
  stock_mode: 'availability',
};
