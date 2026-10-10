import { describe, expect, it } from 'vitest';
import { adminNavFor } from '../nav.test-helpers';
import { ROLE_CAPS } from './testing';

describe('role-based nav visibility', () => {
  it('marketing manager sees coupons, content and social links but not staff, settings or audit', () => {
    const items = adminNavFor(ROLE_CAPS.MARKETING_MANAGER!);
    expect(items).toEqual(expect.arrayContaining(['Coupons', 'Content', 'Social links']));
    for (const hidden of ['Staff', 'Settings', 'Audit log', 'Customers'])
      expect(items).not.toContain(hidden);
  });
  it('support agent sees customers but not coupons or staff', () => {
    const items = adminNavFor(ROLE_CAPS.SUPPORT_AGENT!);
    expect(items).toContain('Customers');
    for (const hidden of ['Coupons', 'Staff', 'Settings', 'Audit log', 'Content'])
      expect(items).not.toContain(hidden);
  });
  it('admin sees everything except staff; super admin sees staff too', () => {
    expect(adminNavFor(ROLE_CAPS.ADMIN!)).not.toContain('Staff');
    expect(adminNavFor(ROLE_CAPS.ADMIN!)).toEqual(
      expect.arrayContaining(['Settings', 'Audit log', 'Coupons']),
    );
    expect(adminNavFor(ROLE_CAPS.SUPER_ADMIN!)).toContain('Staff');
  });
});
