import { Ban, CircleCheckBig } from 'lucide-react';
import { Badge } from '@/design';

/** Account state chip: icon + text, never colour alone. */
export function AccountStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="success">
      <CircleCheckBig aria-hidden="true" />
      Active
    </Badge>
  ) : (
    <Badge tone="danger">
      <Ban aria-hidden="true" />
      Suspended
    </Badge>
  );
}
