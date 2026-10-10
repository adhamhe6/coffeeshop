import type { ReactNode } from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

const TONES = {
  info: { box: 'border-info/30 bg-info-bg', icon: Info, label: 'Note' },
  warning: { box: 'border-warning/40 bg-warning-bg', icon: TriangleAlert, label: 'Heads up' },
  danger: { box: 'border-danger/30 bg-danger-bg', icon: CircleAlert, label: 'Important' },
} as const;

interface CalloutProps {
  tone?: keyof typeof TONES;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  role?: 'status' | 'alert' | 'note';
}

/** Inline notice. Tone is carried by icon + visible label, never colour alone. */
export function Callout({
  tone = 'info',
  title,
  children,
  className,
  role = 'note',
}: CalloutProps) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div
      role={role}
      className={cn('flex items-start gap-3 rounded-md border p-3.5 text-sm', t.box, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="grid gap-1 text-text">
        <p className="font-semibold">{title ?? t.label}</p>
        <div className="text-text">{children}</div>
      </div>
    </div>
  );
}
