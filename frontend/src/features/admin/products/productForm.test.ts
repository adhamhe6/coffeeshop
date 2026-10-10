import { describe, expect, it } from 'vitest';
import type { AdminProduct } from '@/lib/api/adminCatalog';
import {
  changedPayload,
  EMPTY_PRODUCT,
  fromProduct,
  normalisePrice,
  productSchema,
  slugify,
  toPayload,
  type ProductFormValues,
} from './productForm';

const valid: ProductFormValues = {
  ...EMPTY_PRODUCT,
  name: ' Flat White ',
  sku: 'LC-0203',
  category: '2',
  base_price: '4.4',
};

describe('normalisePrice', () => {
  it('keeps prices as two-decimal strings without float maths', () => {
    expect(normalisePrice('4.4')).toBe('4.40');
    expect(normalisePrice('4')).toBe('4.00');
    expect(normalisePrice(' 0012.5 ')).toBe('12.50');
    expect(normalisePrice('0.07')).toBe('0.07');
    expect(normalisePrice('999999.99')).toBe('999999.99');
  });
  it('rejects anything that is not a plain non-negative decimal', () => {
    for (const bad of ['', '-1', '4,50', '4.555', 'abc', '1e3', '1234567', '.5', '$4']) {
      expect(normalisePrice(bad), bad).toBeNull();
    }
  });
});

describe('slugify', () => {
  it('suggests a url-safe slug', () => {
    expect(slugify('Café Crème (Iced)')).toBe('cafe-creme-iced');
    expect(slugify('  --Hello   World-- ')).toBe('hello-world');
    expect(slugify('')).toBe('');
  });
});

describe('productSchema', () => {
  it('accepts a minimal valid product', () => {
    expect(productSchema.safeParse(valid).success).toBe(true);
  });

  it('requires name, SKU, category and price with helpful messages', () => {
    const result = productSchema.safeParse({ ...EMPTY_PRODUCT });
    expect(result.success).toBe(false);
    const messages = Object.fromEntries(
      (result.success ? [] : result.error.issues).map((i) => [i.path.join('.'), i.message]),
    );
    expect(messages.name).toBe('Enter a name.');
    expect(messages.sku).toBe('Enter a SKU.');
    expect(messages.category).toBe('Choose a category.');
    expect(messages.base_price).toBe('Enter a price.');
  });

  it('rejects negative, malformed and over-precise prices', () => {
    for (const price of ['-1.00', '4.555', 'free']) {
      const r = productSchema.safeParse({ ...valid, base_price: price });
      expect(r.success, price).toBe(false);
    }
    expect(productSchema.safeParse({ ...valid, base_price: '0' }).success).toBe(true);
  });

  it('validates the slug characters and optional numbers', () => {
    expect(productSchema.safeParse({ ...valid, slug: 'has space' }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, calories: '12.5' }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, calories: '' }).success).toBe(true);
    expect(productSchema.safeParse({ ...valid, prep_minutes: '99999' }).success).toBe(false);
  });

  it('validates nutrition rows (name needed, numeric range, unique names)', () => {
    const bad = productSchema.safeParse({
      ...valid,
      nutrition: [
        { key: '', value: '5' },
        { key: 'sugar g', value: '999999' },
        { key: 'Sugar_g', value: '1' },
      ],
    });
    expect(bad.success).toBe(false);
    const paths = (bad.success ? [] : bad.error.issues).map((i) => i.path.join('.'));
    expect(paths).toContain('nutrition.0.key');
    expect(paths).toContain('nutrition.1.value');
    expect(paths).toContain('nutrition.2.key');
  });
});

describe('toPayload', () => {
  it('shapes the request: trimmed text, decimal string price, numbers, nested group ids in order', () => {
    const payload = toPayload({
      ...valid,
      slug: 'Flat-White',
      short_description: ' Smooth ',
      calories: '120',
      caffeine_mg: '',
      prep_minutes: '4',
      allergens: ['milk'],
      tags: ['hot', 'vegan'],
      modifier_group_ids: [5, 2, 9],
      collection_ids: [1, 2],
      nutrition: [
        { key: 'Protein (g)', value: '8' },
        { key: 'serving size', value: 'Small' },
        { key: '', value: '' },
      ],
    });
    expect(payload).toEqual({
      name: 'Flat White',
      sku: 'LC-0203',
      slug: 'flat-white',
      category: 2,
      product_type: 'BEVERAGE',
      stock_mode: 'PREPARED',
      short_description: 'Smooth',
      description: '',
      base_price: '4.40',
      is_active: true,
      is_featured: false,
      is_bestseller: false,
      is_seasonal: false,
      is_new: false,
      is_sold_out: false,
      prep_minutes: 4,
      calories: 120,
      caffeine_mg: null,
      allergens: ['milk'],
      nutrition: { protein_g: 8, serving_size: 'Small' },
      tags: ['hot', 'vegan'],
      modifier_group_ids: [5, 2, 9],
    });
    expect(typeof payload.base_price).toBe('string');
    expect(payload).not.toHaveProperty('collection_ids');
  });

  it('omits an empty slug so the server generates a unique one', () => {
    expect(toPayload({ ...valid, slug: '' })).not.toHaveProperty('slug');
  });
});

describe('changedPayload', () => {
  const product: AdminProduct = {
    id: 3,
    slug: 'flat-white',
    sku: 'LC-0203',
    name: 'Flat White',
    category: 2,
    category_name: 'Milk Coffee',
    product_type: 'BEVERAGE',
    stock_mode: 'PREPARED',
    short_description: '',
    description: '',
    base_price: '4.40',
    image: null,
    gallery: [],
    is_active: true,
    is_featured: false,
    is_bestseller: false,
    is_seasonal: false,
    is_new: false,
    is_sold_out: false,
    prep_minutes: 4,
    calories: null,
    caffeine_mg: null,
    allergens: [],
    nutrition: {},
    tags: [],
    modifier_group_ids: [5, 2],
    modifier_groups: [],
    sort_order: 1,
    is_demo: false,
    created_at: '',
    updated_at: '',
  };

  it('sends only what changed (price) so other concurrent edits survive', () => {
    const base = fromProduct(product);
    const next = toPayload({ ...base, base_price: '4.9' });
    expect(changedPayload(next, toPayload(base))).toEqual({ base_price: '4.90' });
  });

  it('treats a reordered group list as a change', () => {
    const base = fromProduct(product);
    const next = toPayload({ ...base, modifier_group_ids: [2, 5] });
    expect(changedPayload(next, toPayload(base))).toEqual({ modifier_group_ids: [2, 5] });
  });

  it('is empty when nothing changed', () => {
    const base = fromProduct(product);
    expect(changedPayload(toPayload(base), toPayload(base))).toEqual({});
  });
});
