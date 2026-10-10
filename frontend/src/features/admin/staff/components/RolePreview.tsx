import { Check } from 'lucide-react';
import type { RoleInfo } from '@/lib/api/peopleTypes';
import { branchScopeLabel, groupCapabilities } from '../capabilityLabels';
import { capabilityLabel } from '../capabilityLabels';

/** "What can this role do?" panel next to the role select in the staff dialog. */
export function RolePreview({ role }: { role: RoleInfo | undefined }) {
  if (!role) {
    return (
      <div className="rounded-md bg-surface-sunken p-4 text-sm text-text-muted">
        Choose a role to see what it can do.
      </div>
    );
  }
  const groups = groupCapabilities(role.capabilities);
  return (
    <section
      aria-label={`What the ${role.label} role can do`}
      className="rounded-md bg-surface-sunken p-4"
    >
      <h3 className="text-sm font-semibold">{role.label} can…</h3>
      <p className="mt-0.5 text-xs text-text-muted">Branch access: {branchScopeLabel(role)}</p>
      <div className="mt-3 grid gap-3">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              {g.label}
            </p>
            <ul className="mt-1 grid gap-1 text-sm">
              {g.capabilities.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{capabilityLabel(c)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
