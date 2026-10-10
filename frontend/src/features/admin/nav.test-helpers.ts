import { visibleAdminNav } from './nav';

/** Labels the sidebar should show for a set of capabilities (test helper). */
export const adminNavFor = (capabilities: string[]) =>
  visibleAdminNav((c) => capabilities.includes(c)).flatMap((g) => g.items.map((i) => i.label));
