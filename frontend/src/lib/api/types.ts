/**
 * Hand-written API types, derived from docs/implementation-plan.md and the backend models.
 * They are intentionally conservative (optional where the plan is loose). Once `npm run gen:api` has produced
 * `schema.d.ts`, prefer `components['schemas'][…]` for new code and tighten these.
 *
 * Money values are decimal STRINGS ("4.50"); image URLs are root-relative (`/media/…`) or null.
 */

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Auth ────────────────────────────────────────────────────────────────
export interface StaffInfo {
  role: string;
  role_label?: string;
  job_title?: string;
  capabilities: string[];
  /** `null` = all branches. */
  branch_ids: number[] | null;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  marketing_opt_in?: boolean;
  /** `false` until the customer follows the link we email. Checkout does not require it. */
  email_verified?: boolean;
}

/** `GET auth/me/` (200 for anonymous visitors too) and the body of `POST auth/login/`. */
export interface MeResponse {
  authenticated: boolean;
  user: User | null;
  staff: StaffInfo | null;
  unread_notifications: number;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  marketing_opt_in?: boolean;
}

// ── Store / content ─────────────────────────────────────────────────────
export type SocialPlatform = 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'pinterest' | 'x';

export interface SocialLink {
  /** Known values: see `SocialPlatform`; unknown platforms get a generic icon. */
  platform: SocialPlatform | (string & {});
  url: string;
  handle?: string;
  is_placeholder?: boolean;
}

export interface Announcement {
  id?: number;
  message: string;
  link_url?: string;
}

export interface StoreInfo {
  brand_name: string;
  tagline: string;
  currency: string;
  support_email?: string;
  support_phone?: string;
  business_address?: string;
  logo?: string | null;
  tax_label?: string;
  tax_rate?: string;
  prices_include_tax?: boolean;
  enable_reviews?: boolean;
  ordering_enabled?: boolean;
  checkout_methods?: string[];
  social?: SocialLink[];
  announcement?: Announcement | null;
}

export interface ContentBlock {
  key: string;
  eyebrow?: string;
  title?: string;
  body?: string;
  image?: string | null;
  cta_label?: string;
  cta_url?: string;
}

export interface ContentPage {
  slug: string;
  title: string;
  summary?: string;
  body_markdown: string;
  updated_at?: string;
}

// ── Catalogue ───────────────────────────────────────────────────────────
export interface Category {
  id: number;
  slug: string;
  name: string;
  description?: string;
  image?: string | null;
  is_featured?: boolean;
  sort_order?: number;
  product_count?: number;
}

export type ProductType = 'BEVERAGE' | 'FOOD' | 'BEANS' | 'MERCH' | 'GIFT';

export interface ProductFlags {
  is_featured?: boolean;
  is_bestseller?: boolean;
  is_seasonal?: boolean;
  is_new?: boolean;
}

/** Card payload used by lists, collections, favourites and related products. */
export interface ProductSummary {
  id: number;
  slug: string;
  name: string;
  short_description?: string;
  /** Smallest/default size price. */
  base_price: string;
  image: string | null;
  category?: { slug: string; name: string } | null;
  flags?: ProductFlags;
  product_type?: ProductType;
  stock_mode?: 'PREPARED' | 'STOCKED';
  allergens?: string[];
  tags?: Array<{ slug: string; name: string }>;
  rating_avg?: number | null;
  rating_count?: number;
  /** True when the product has modifier groups (needs the detail page to customise). */
  has_options?: boolean;
  is_available?: boolean;
  unavailable_reason?: 'inactive' | 'sold_out' | 'branch_unavailable' | 'out_of_stock' | null;
}

export interface ModifierOption {
  id: number;
  name: string;
  price_delta: string;
  is_default?: boolean;
  is_available?: boolean;
}

export interface ModifierGroup {
  id: number;
  display_name: string;
  selection_type: 'SINGLE' | 'MULTIPLE';
  is_required: boolean;
  min_select: number;
  max_select: number;
  options: ModifierOption[];
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  distribution: Array<{ rating: number; count: number }>;
}

export interface ProductDetail extends ProductSummary {
  description?: string;
  gallery?: Array<{ id: number; url: string | null; alt_text?: string }>;
  modifier_groups?: ModifierGroup[];
  nutrition?: Record<string, unknown>;
  calories?: number | null;
  caffeine_mg?: number | null;
  prep_minutes?: number;
  reviews?: ReviewSummary;
  related?: ProductSummary[];
}

export interface Collection {
  id: number;
  slug: string;
  name: string;
  description?: string;
  image?: string | null;
  is_featured?: boolean;
  sort_order?: number;
  product_count?: number;
}

export interface CollectionDetail extends Collection {
  products: ProductSummary[];
}

export interface ProductListParams {
  q?: string;
  category?: string;
  collection?: string;
  tag?: string;
  type?: ProductType;
  featured?: boolean;
  bestseller?: boolean;
  seasonal?: boolean;
  new?: boolean;
  min_price?: number | string;
  max_price?: number | string;
  /** Branch slug or id: makes availability branch-aware. */
  branch?: string | number;
  ordering?: 'menu' | 'relevance' | 'price' | '-price' | 'name' | '-name' | 'popularity' | 'newest';
  page?: number;
  page_size?: number;
}

export interface ProductSuggestion {
  slug: string;
  name: string;
  image?: string | null;
  base_price?: string;
  category?: { slug: string; name: string } | null;
}

// ── Branches ────────────────────────────────────────────────────────────
export interface BranchHours {
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  label?: string;
  /** Human text such as "7:00 am – 6:00 pm" or "Closed". */
  text?: string;
  opens: string | null;
  closes: string | null;
  is_closed: boolean;
}

export interface Branch {
  id: number;
  code?: string;
  slug: string;
  name: string;
  description?: string;
  image?: string | null;
  address_line: string;
  city: string;
  postal_code?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  latitude?: string | null;
  longitude?: string | null;
  pickup_enabled?: boolean;
  delivery_enabled?: boolean;
  accepting_orders?: boolean;
  prep_minutes?: number;
  is_placeholder_address?: boolean;
  is_open_now?: boolean;
  today_hours?: { text: string; opens: string | null; closes: string | null; is_closed: boolean };
  hours?: BranchHours[];
  next_open_at?: string | null;
  delivery_zones?: Array<{
    zone_id: number;
    name: string;
    slug: string;
    fee?: string;
    min_order_total?: string;
    free_delivery_over?: string | null;
    eta_minutes?: number;
  }>;
}

// ── Cart ────────────────────────────────────────────────────────────────
export interface CartIssue {
  code: string;
  message: string;
  severity?: 'error' | 'warning';
  item_id?: number;
  group?: string;
  data?: Record<string, unknown>;
}

export interface CartItem {
  id: number;
  quantity: number;
  unit_price: string;
  line_total: string;
  note: string;
  product: { id: number; slug: string; name: string; image: string | null; is_available?: boolean };
  options: Array<{ group: string; name: string; price_delta: string }>;
  price_changed?: { was: string; now: string } | null;
  issues: CartIssue[];
}

export interface Cart {
  items: CartItem[];
  /** Total units across lines (drives the header badge). */
  item_count: number;
  subtotal: string;
  currency?: string;
  issues?: CartIssue[];
  branch_id?: number | null;
}

export interface AddCartItemPayload {
  product_id: number;
  quantity: number;
  /** Selected ModifierOption ids. */
  option_ids?: number[];
  note?: string;
}

// ── Notifications ───────────────────────────────────────────────────────
export interface NotificationItem {
  id: number;
  kind?: string;
  title: string;
  body?: string;
  is_read: boolean;
  created_at: string;
  link?: string | null;
}
