import type { AuditLogEntry } from '@/lib/api/peopleTypes';

/** Resource types (Django model labels, as stored by the backend) with plain-language names. */
export const RESOURCE_TYPES: { value: string; label: string }[] = [
  { value: 'accounts.User', label: 'User account (customer or staff)' },
  { value: 'promotions.Coupon', label: 'Coupon' },
  { value: 'orders.Order', label: 'Order' },
  { value: 'payments.Payment', label: 'Payment' },
  { value: 'catalog.Product', label: 'Product' },
  { value: 'catalog.Category', label: 'Category' },
  { value: 'catalog.ModifierGroup', label: 'Option group' },
  { value: 'catalog.Collection', label: 'Collection' },
  { value: 'branches.Branch', label: 'Branch' },
  { value: 'core.StoreSettings', label: 'Store settings' },
  { value: 'core.ContentPage', label: 'Content page' },
  { value: 'core.ContentBlock', label: 'Homepage block' },
  { value: 'core.Announcement', label: 'Announcement' },
  { value: 'core.SocialProfile', label: 'Social link' },
  { value: 'newsletter', label: 'Newsletter' },
];

/** Known audit actions → readable label. Unknown actions fall back to a humanised version of the code. */
export const ACTIONS: { value: string; label: string }[] = [
  { value: 'coupon.create', label: 'Coupon created' },
  { value: 'coupon.update', label: 'Coupon edited' },
  { value: 'coupon.activate', label: 'Coupon activated' },
  { value: 'coupon.deactivate', label: 'Coupon deactivated' },
  { value: 'coupon.delete', label: 'Coupon deleted' },
  { value: 'customer.suspend', label: 'Customer suspended' },
  { value: 'customer.restore', label: 'Customer restored' },
  { value: 'staff.create', label: 'Staff member added' },
  { value: 'staff.update', label: 'Staff member edited' },
  { value: 'staff.activate', label: 'Staff member reactivated' },
  { value: 'staff.deactivate', label: 'Staff member deactivated' },
  { value: 'settings.update', label: 'Store settings changed' },
  { value: 'content_page.update', label: 'Page edited' },
  { value: 'content_block.update', label: 'Homepage block edited' },
  { value: 'content_block.create', label: 'Homepage block created' },
  { value: 'announcement.create', label: 'Announcement created' },
  { value: 'announcement.update', label: 'Announcement edited' },
  { value: 'announcement.delete', label: 'Announcement deleted' },
  { value: 'social.create', label: 'Social link added' },
  { value: 'social.update', label: 'Social link edited' },
  { value: 'social.delete', label: 'Social link removed' },
  { value: 'newsletter.export', label: 'Newsletter list exported' },
  { value: 'order.transition', label: 'Order status changed' },
  { value: 'order.cancel', label: 'Order cancelled' },
  { value: 'payment.refund', label: 'Refund issued' },
  { value: 'product.create', label: 'Product created' },
  { value: 'product.update', label: 'Product edited' },
  { value: 'product.archive', label: 'Product archived' },
  { value: 'product.unarchive', label: 'Product restored' },
  { value: 'category.create', label: 'Category created' },
  { value: 'category.update', label: 'Category edited' },
  { value: 'inventory.adjust', label: 'Stock adjusted' },
  { value: 'branch.update', label: 'Branch edited' },
  { value: 'review.approve', label: 'Review approved' },
  { value: 'review.reject', label: 'Review rejected' },
  { value: 'reports.export', label: 'Report exported' },
];

const humanise = (s: string) => s.replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const actionLabel = (action: string) =>
  ACTIONS.find((a) => a.value === action)?.label ?? humanise(action);

export const resourceLabel = (type: string) =>
  RESOURCE_TYPES.find((r) => r.value === type)?.label ??
  (type ? humanise(type.split('.').pop() ?? type) : '—');

/** Admin page for the audited resource, when one exists. `null` when there is nothing sensible to open. */
export function resourceLink(
  entry: Pick<AuditLogEntry, 'action' | 'resource_type' | 'resource_id'>,
): string | null {
  const { resource_type: type, resource_id: id, action } = entry;
  switch (type) {
    case 'accounts.User':
      if (action.startsWith('customer.') && id) return `/admin/customers/${encodeURIComponent(id)}`;
      if (action.startsWith('staff.')) return '/admin/staff';
      return null;
    case 'promotions.Coupon':
      return action === 'coupon.delete' || !id
        ? '/admin/coupons'
        : `/admin/coupons/${encodeURIComponent(id)}`;
    case 'catalog.Product':
      return id && !action.endsWith('.delete')
        ? `/admin/products/${encodeURIComponent(id)}`
        : '/admin/products';
    case 'catalog.Category':
      return '/admin/categories';
    case 'branches.Branch':
      return '/admin/branches';
    case 'core.StoreSettings':
      return '/admin/settings';
    case 'core.SocialProfile':
      return '/admin/social';
    case 'core.ContentPage':
    case 'core.ContentBlock':
    case 'core.Announcement':
      return '/admin/content';
    default:
      return null;
  }
}

// ── change summaries ────────────────────────────────────────────────────
export interface ChangeRow {
  field: string;
  kind: 'diff' | 'value' | 'note';
  from?: string;
  to?: string;
  value?: string;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(', ') : 'none';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Normalise the free-form `changes` JSON the backend records into table rows.
 * Shapes seen: `{field:{from,to}}`, `{field:[before,after]}` (coupon edits), `{field:"changed"}` (long text/files),
 * flat snapshots on create, `{fields:[…]}` lists and notes like `{reason}`.
 */
export function normalizeChanges(action: string, changes: unknown): ChangeRow[] {
  if (!isRecord(changes)) return [];
  const isUpdate = action.endsWith('.update');
  const rows: ChangeRow[] = [];
  for (const [field, raw] of Object.entries(changes)) {
    if (isRecord(raw) && 'from' in raw && 'to' in raw && Object.keys(raw).length === 2) {
      rows.push({ field, kind: 'diff', from: formatValue(raw.from), to: formatValue(raw.to) });
    } else if (isUpdate && Array.isArray(raw) && raw.length === 2 && !Array.isArray(raw[0])) {
      rows.push({ field, kind: 'diff', from: formatValue(raw[0]), to: formatValue(raw[1]) });
    } else if (raw === 'changed' || raw === 'removed') {
      rows.push({
        field,
        kind: 'note',
        value: raw === 'changed' ? 'Changed (content not recorded)' : 'Removed',
      });
    } else if (field === 'fields' && Array.isArray(raw)) {
      rows.push({
        field: 'Also updated',
        kind: 'value',
        value: raw.map((f) => humanise(String(f))).join(', '),
      });
    } else {
      rows.push({ field, kind: 'value', value: formatValue(raw) });
    }
  }
  return rows;
}

export const fieldLabel = (f: string) => humanise(f);
