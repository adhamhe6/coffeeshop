import type {
  Branch,
  Category,
  Collection,
  ContentBlock,
  MeResponse,
  ProductDetail,
  ProductSummary,
  StoreInfo,
  User,
} from '@/lib/api/types';
import { art } from './art';

export const store: StoreInfo = {
  brand_name: 'Lantern Coffee Roasters',
  tagline: 'Slow-roasted. Carefully poured.',
  currency: 'USD',
  support_email: 'hello@lantern.example',
  support_phone: '+1 555 010 0100',
  business_address: '1 Placeholder Street, Replace City',
  logo: null,
  tax_label: 'Tax',
  prices_include_tax: false,
  ordering_enabled: true,
  enable_reviews: true,
  checkout_methods: ['demo', 'cash'],
  social: [
    {
      platform: 'instagram',
      url: 'https://instagram.com/lantern.example',
      handle: '@lantern.example',
      is_placeholder: true,
    },
    {
      platform: 'facebook',
      url: 'https://facebook.com/lantern.example',
      handle: 'lantern.example',
      is_placeholder: true,
    },
  ],
  announcement: {
    id: 1,
    message: 'Free pastry with any beans order this week',
    link_url: '/menu?type=BEANS',
  },
};

export const categories: Category[] = [
  {
    id: 1,
    slug: 'espresso-bar',
    name: 'Espresso Bar',
    description: 'Flat whites, cortados and everything pulled on our two-group machine.',
    image: art('cup', 'cream'),
    is_featured: true,
    sort_order: 1,
    product_count: 6,
  },
  {
    id: 2,
    slug: 'cold-brew',
    name: 'Cold Brew & Iced',
    description: 'Steeped for 18 hours, served over clear ice.',
    image: art('iced', 'sage'),
    is_featured: true,
    sort_order: 2,
    product_count: 3,
  },
  {
    id: 3,
    slug: 'whole-bean',
    name: 'Whole Bean Coffee',
    description: 'Take the roast home.',
    image: art('bag', 'clay'),
    is_featured: true,
    sort_order: 3,
    product_count: 3,
  },
  {
    id: 4,
    slug: 'bakery',
    name: 'Bakery',
    description: 'Baked in the morning, sold until it is gone.',
    image: art('pastry', 'sand'),
    is_featured: false,
    sort_order: 4,
    product_count: 2,
  },
  {
    id: 5,
    slug: 'merch',
    name: 'Merch & Gear',
    description: 'Mugs, filters and tools we actually use.',
    image: art('mug', 'night'),
    is_featured: false,
    sort_order: 5,
    product_count: 2,
  },
];

const flags = (o: Partial<NonNullable<ProductSummary['flags']>> = {}) => ({
  is_featured: false,
  is_bestseller: false,
  is_seasonal: false,
  is_new: false,
  ...o,
});

function p(
  id: number,
  slug: string,
  name: string,
  price: string,
  cat: number,
  short: string,
  extra: Partial<ProductSummary> = {},
  kind: Parameters<typeof art>[0] = 'cup',
  palette: Parameters<typeof art>[1] = 'cream',
): ProductSummary {
  const c = categories.find((x) => x.id === cat);
  return {
    id,
    slug,
    name,
    short_description: short,
    base_price: price,
    image: art(kind, palette),
    category: c ? { slug: c.slug, name: c.name } : null,
    flags: flags(),
    product_type: 'BEVERAGE',
    stock_mode: 'PREPARED',
    allergens: [],
    tags: [],
    rating_avg: 4.7,
    rating_count: 18,
    has_options: true,
    is_available: true,
    unavailable_reason: null,
    ...extra,
  };
}

export const products: ProductSummary[] = [
  p(1, 'flat-white', 'Flat White', '4.50', 1, 'Double ristretto, silky microfoam, a thin pour.', {
    flags: flags({ is_featured: true, is_bestseller: true }),
  }),
  p(
    2,
    'cortado',
    'Cortado',
    '4.00',
    1,
    'Equal parts espresso and warm milk. Quiet and strong.',
    { flags: flags({ is_featured: true }) },
    'cup',
    'sand',
  ),
  p(
    3,
    'oat-latte',
    'Oat Latte',
    '5.25',
    1,
    'Barista oat milk, house espresso, cinnamon dust.',
    { flags: flags({ is_featured: true, is_bestseller: true }) },
    'cup',
    'clay',
  ),
  p(
    4,
    'cold-brew',
    'Cold Brew',
    '4.75',
    2,
    'Eighteen hours steeped, served over clear ice.',
    { flags: flags({ is_featured: true, is_bestseller: true }) },
    'iced',
    'sage',
  ),
  p(
    5,
    'spiced-pumpkin-latte',
    'Spiced Pumpkin Latte',
    '5.75',
    1,
    'Roasted pumpkin, warm spice, espresso.',
    { flags: flags({ is_seasonal: true, is_new: true, is_featured: true }) },
    'cup',
    'clay',
  ),
  p(
    6,
    'maple-cortado',
    'Maple Cortado',
    '4.75',
    1,
    'Dark maple syrup and a double shot.',
    { flags: flags({ is_seasonal: true }) },
    'cup',
    'sand',
  ),
  p(
    7,
    'chai-cold-foam',
    'Iced Chai, Cold Foam',
    '5.25',
    2,
    'House chai concentrate, vanilla cold foam.',
    { flags: flags({ is_seasonal: true }) },
    'iced',
    'clay',
  ),
  p(
    8,
    'matcha-latte',
    'Ceremonial Matcha',
    '5.50',
    1,
    'Whisked to order with oat or whole milk.',
    { flags: flags({ is_bestseller: true }) },
    'tea',
    'sage',
  ),
  p(
    9,
    'house-blend-250',
    'House Blend, 250 g',
    '14.00',
    3,
    'Chocolate, orange peel and toasted almond.',
    {
      product_type: 'BEANS',
      stock_mode: 'STOCKED',
      has_options: true,
      flags: flags({ is_bestseller: true }),
    },
    'bag',
    'clay',
  ),
  p(
    10,
    'ethiopia-guji-250',
    'Ethiopia Guji, 250 g',
    '17.50',
    3,
    'Blueberry jam, jasmine, a clean finish.',
    { product_type: 'BEANS', stock_mode: 'STOCKED', flags: flags({ is_new: true }) },
    'bag',
    'sage',
  ),
  p(
    11,
    'decaf-250',
    'Swiss Water Decaf, 250 g',
    '15.00',
    3,
    'Sweet and round, nothing missing but the buzz.',
    { product_type: 'BEANS', stock_mode: 'STOCKED' },
    'bag',
    'sand',
  ),
  p(
    12,
    'butter-croissant',
    'Butter Croissant',
    '3.75',
    4,
    'Laminated over two days. Shatters properly.',
    { product_type: 'FOOD', has_options: false, flags: flags({ is_bestseller: true }) },
    'pastry',
    'sand',
  ),
  p(
    13,
    'lantern-mug',
    'Lantern Mug',
    '18.00',
    5,
    'Hand-glazed stoneware, 300 ml.',
    { product_type: 'MERCH', stock_mode: 'STOCKED', has_options: false },
    'mug',
    'night',
  ),
  p(
    14,
    'pour-over-kit',
    'Pour-over Kit',
    '38.00',
    5,
    'Dripper, 40 filters and a scoop.',
    { product_type: 'MERCH', stock_mode: 'STOCKED', has_options: false },
    'mug',
    'sage',
  ),
];

export const productDetail = (slug: string): ProductDetail | undefined => {
  const base = products.find((x) => x.slug === slug);
  if (!base) return undefined;
  return {
    ...base,
    description: 'A fuller description of the product, written for the detail page.',
    gallery: [],
    modifier_groups: [
      {
        id: 1,
        display_name: 'Size',
        selection_type: 'SINGLE',
        is_required: true,
        min_select: 1,
        max_select: 1,
        options: [
          { id: 1, name: 'Small', price_delta: '0.00', is_default: true, is_available: true },
          { id: 2, name: 'Large', price_delta: '0.75', is_available: true },
        ],
      },
    ],
    reviews: { average: 4.7, count: 18, distribution: [] },
    related: products.slice(0, 3),
  };
};

export const collections: Collection[] = [
  {
    id: 1,
    slug: 'seasonal-menu',
    name: 'Seasonal Menu',
    description: 'Autumn in a cup.',
    image: art('landscape', 'clay', [400, 300]),
    is_featured: true,
    sort_order: 1,
    product_count: 3,
  },
];

const hours = (open: string, close: string, closedDays: number[] = []) =>
  Array.from({ length: 7 }, (_, weekday) => {
    const closed = closedDays.includes(weekday);
    return {
      weekday,
      label: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][
        weekday
      ] as string,
      text: closed ? 'Closed' : `${open} – ${close}`,
      opens: closed ? null : '07:00:00',
      closes: closed ? null : '18:00:00',
      is_closed: closed,
    };
  });

export const branches: Branch[] = [
  {
    id: 1,
    slug: 'old-town',
    code: 'OT',
    name: 'Old Town Roastery',
    description: 'Our roastery and flagship bar.',
    image: art('landscape', 'sand', [400, 300]),
    address_line: '12 Cooper Lane',
    city: 'Replace City',
    postal_code: '00001',
    phone: '+1 555 010 0101',
    timezone: 'UTC',
    is_placeholder_address: true,
    pickup_enabled: true,
    delivery_enabled: true,
    accepting_orders: true,
    prep_minutes: 10,
    is_open_now: true,
    today_hours: {
      text: '7:00 am – 6:00 pm',
      opens: '07:00:00',
      closes: '18:00:00',
      is_closed: false,
    },
    hours: hours('7:00 am', '6:00 pm'),
  },
  {
    id: 2,
    slug: 'riverside',
    code: 'RS',
    name: 'Riverside',
    description: 'A bright corner bar by the water.',
    image: art('landscape', 'sage', [400, 300]),
    address_line: '88 Quay Street',
    city: 'Replace City',
    postal_code: '00002',
    phone: '+1 555 010 0102',
    timezone: 'UTC',
    is_placeholder_address: true,
    pickup_enabled: true,
    delivery_enabled: false,
    accepting_orders: true,
    prep_minutes: 8,
    is_open_now: true,
    today_hours: {
      text: '8:00 am – 4:00 pm',
      opens: '08:00:00',
      closes: '16:00:00',
      is_closed: false,
    },
    hours: hours('8:00 am', '4:00 pm', [6]),
  },
];

export const blocks: Record<string, ContentBlock> = {
  'home.hero': {
    key: 'home.hero',
    eyebrow: 'Small-batch roasters',
    title: 'Coffee worth slowing down for.',
    body: 'We roast in small batches, pour with care and keep the menu short. Order ahead and your cup is waiting.',
    image: art('cup', 'cream', [400, 500]),
    cta_label: 'Order for pickup',
    cta_url: '/menu',
  },
  'home.story': {
    key: 'home.story',
    eyebrow: 'Our story',
    title: 'A roastery with the lights on',
    body: 'Lantern started as a single roaster in a corner of a workshop. We kept the lights on late, learned from every batch, and opened the doors.\n\nToday we still roast every week, in small lots, so what you drink is never old.',
    image: art('landscape', 'sand', [400, 500]),
    cta_label: 'Read our story',
    cta_url: '/about',
  },
  'home.sourcing': {
    key: 'home.sourcing',
    eyebrow: 'Sourcing',
    title: 'Coffee we can name the farm of',
    body: 'We buy from producers we can name and pay above market so they can keep growing great coffee.\n\nEvery bag tells you where it came from, who grew it and how we roast it.',
    image: art('landscape', 'sage', [400, 500]),
    cta_label: 'Shop beans',
    cta_url: '/menu?type=BEANS',
  },
};

export const demoUser: User = {
  id: 7,
  email: 'customer@example.com',
  first_name: 'Alex',
  last_name: 'Morgan',
  phone: '',
  marketing_opt_in: false,
};

export const anonymousMe: MeResponse = {
  authenticated: false,
  user: null,
  staff: null,
  unread_notifications: 0,
};
export const customerMe: MeResponse = {
  authenticated: true,
  user: demoUser,
  staff: null,
  unread_notifications: 2,
};
export const staffMe: MeResponse = {
  authenticated: true,
  user: { ...demoUser, id: 1, email: 'admin@example.com', first_name: 'Sam', last_name: 'Admin' },
  staff: {
    role: 'ADMIN',
    role_label: 'Admin',
    job_title: 'Store manager',
    capabilities: [
      'dashboard.view',
      'orders.view',
      'catalog.view',
      'catalog.manage',
      'settings.manage',
    ],
    branch_ids: null,
  },
  unread_notifications: 0,
};

export const DEMO_PASSWORD = 'lantern-demo-1';
