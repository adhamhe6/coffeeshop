import { configure } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { vi } from 'vitest';
import { state } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { staffMe } from '@/mocks/fixtures';
import type { MeResponse } from '@/lib/api/types';

// Lazy admin chunks plus Radix make first renders slow on busy CI machines; give async queries room.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 30_000 });

/** Capability sets copied from the backend role map (docs/implementation-plan.md §4) for tests. */
export const ROLE_CAPS: Record<string, string[]> = {
  SUPER_ADMIN: [
    'dashboard.view',
    'catalog.view',
    'catalog.manage',
    'inventory.view',
    'inventory.manage',
    'orders.view',
    'orders.manage',
    'orders.cancel',
    'orders.note',
    'payments.view',
    'payments.refund',
    'payments.collect',
    'customers.view',
    'customers.manage',
    'promotions.manage',
    'reviews.moderate',
    'content.manage',
    'branches.view',
    'branches.manage',
    'staff.manage',
    'settings.manage',
    'reports.view',
    'reports.export',
    'audit.view',
  ],
  MARKETING_MANAGER: [
    'dashboard.view',
    'catalog.view',
    'promotions.manage',
    'content.manage',
    'reviews.moderate',
    'reports.view',
  ],
  SUPPORT_AGENT: [
    'dashboard.view',
    'orders.view',
    'orders.note',
    'payments.view',
    'customers.view',
    'catalog.view',
  ],
};
ROLE_CAPS.ADMIN = ROLE_CAPS.SUPER_ADMIN!.filter((c) => c !== 'staff.manage');

/** Signs the mock server in as a staff member with the given role (user id 1). */
export function signInAsStaff(
  role: keyof typeof ROLE_CAPS & string,
  userId = 1,
  capabilities: string[] = ROLE_CAPS[role] ?? [],
) {
  const me: MeResponse = {
    ...staffMe,
    user: { ...staffMe.user!, id: userId, first_name: 'Sam', last_name: 'Staff' },
    staff: {
      role,
      role_label: role,
      job_title: '',
      capabilities,
      branch_ids: null,
    },
  };
  state.me = me;
  // The admin shell loads the branch picker on every page.
  server.use(
    http.get('/api/v1/admin/branches/options/', () =>
      HttpResponse.json([
        { id: 1, code: 'DT', name: 'Downtown', slug: 'downtown', is_active: true },
        { id: 2, code: 'RS', name: 'Riverside', slug: 'riverside', is_active: true },
      ]),
    ),
  );
}
