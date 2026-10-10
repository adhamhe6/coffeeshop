import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/** Form-level error banner (wrong password, throttled, network…). `role=alert` so it is announced. */
export function FormAlert({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-bg p-3.5 text-sm font-medium text-danger"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
