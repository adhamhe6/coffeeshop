/**
 * Types for the people / marketing / configuration staff endpoints (`/admin/customers|staff|coupons|pages|blocks|
 * announcements|social|newsletter|settings|audit-logs`). Aliases of the generated OpenAPI schema so a backend change
 * fails `npm run typecheck` here first.
 */
import type { components } from './schema';

type S = components['schemas'];

export type AdminCustomerRow = S['CustomerList'];
export type AdminCustomerDetail = S['CustomerDetail'];
export type AdminCustomerAddress = S['CustomerAddress'];
export type AdminOrderSummary = S['OrderSummary'];

export type AdminStaffMember = S['Staff'];
export type RoleInfo = S['Role'];
export type RoleMatrix = S['RoleMatrix'];
export type StaffCreatePayload = S['StaffCreateRequest'];
export type StaffUpdatePayload = S['PatchedStaffWriteRequest'];
export type BranchOption = S['BranchOption'];

/** The API always sends these (the schema marks them optional because they have request-side defaults). */
export type AdminCoupon = S['AdminCoupon'] & {
  code: string;
  description: string;
  applies_to: S['AppliesToEnum'];
  category_ids: number[];
  product_ids: number[];
  min_order_total: string;
  first_order_only: boolean;
  is_automatic: boolean;
  is_active: boolean;
};
export type CouponPayload = S['AdminCouponRequest'];
export type DiscountType = S['DiscountTypeEnum'];
export type AppliesTo = S['AppliesToEnum'];

type Always<T, K extends keyof T> = T & { [P in K]-?: NonNullable<T[P]> };

export type AdminPage = Always<S['AdminPage'], 'summary' | 'body_markdown' | 'is_published'>;
export type AdminPagePayload = S['PatchedAdminPageRequest'];
export type AdminBlock = Always<
  S['AdminBlock'],
  'eyebrow' | 'title' | 'body' | 'cta_label' | 'cta_url' | 'is_active'
>;
export type AdminAnnouncement = Always<S['AdminAnnouncement'], 'link_url' | 'is_active'>;
export type AdminAnnouncementPayload = S['AdminAnnouncementRequest'];
export type AdminSocial = Always<
  S['AdminSocial'],
  'handle' | 'is_active' | 'is_placeholder' | 'sort_order'
>;
export type AdminSocialPayload = S['AdminSocialRequest'];
export type SocialPlatformKey = S['PlatformEnum'];
export type AdminNewsletterSubscriber = S['AdminNewsletter'];

export type AdminStoreSettings = Always<
  S['AdminStoreSettings'],
  | 'brand_name'
  | 'tagline'
  | 'legal_name'
  | 'support_email'
  | 'support_phone'
  | 'business_address'
  | 'tax_rate'
  | 'tax_label'
  | 'prices_include_tax'
  | 'auto_confirm_paid_orders'
  | 'enable_reviews'
  | 'ordering_enabled'
  | 'allowed_checkout_methods'
>;
/** JSON PATCH body; the logo travels in its own multipart request. */
export type StoreSettingsPatch = Partial<
  Omit<S['PatchedAdminStoreSettingsRequest'], 'logo' | 'remove_logo'>
>;

export type AuditLogEntry = S['AuditLog'];

export type AdminCategoryRef = Pick<S['AdminCategory'], 'id' | 'name' | 'is_active'>;
export type AdminProductRef = Pick<S['AdminProductList'], 'id' | 'name' | 'sku' | 'category_name'>;

export interface PaymentMethodInfo {
  key: string;
  label: string;
  description: string;
  is_sandbox: boolean;
  offline: boolean;
}
