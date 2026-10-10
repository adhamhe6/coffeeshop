import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string, context: { email?: string; names?: string[] }) => boolean;
}

/** Mirrors the backend validators (min length 10, not all numeric, not similar to account details). */
export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { id: 'numeric', label: 'Not only numbers', test: (p) => p.length > 0 && !/^\d+$/.test(p) },
  {
    id: 'personal',
    label: 'Does not contain your name or email',
    test: (p, { email, names }) => {
      const lower = p.toLowerCase();
      const local = email?.split('@')[0]?.toLowerCase();
      const parts = [local, ...(names ?? []).map((n) => n.toLowerCase())].filter(
        (s): s is string => !!s && s.length >= 3,
      );
      return p.length > 0 && !parts.some((s) => lower.includes(s));
    },
  },
];

export function passwordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  else if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 0.5;
  return Math.min(4, Math.floor(score)) as 0 | 1 | 2 | 3 | 4;
}

const LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const BAR = ['bg-border-strong', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'] as const;

interface PasswordStrengthProps {
  password: string;
  email?: string;
  names?: string[];
  id: string;
}

/** Live rules checklist + strength meter. Meets/unmet is conveyed by icon AND text, never colour alone. */
export function PasswordStrength({ password, email, names, id }: PasswordStrengthProps) {
  const score = password.length >= 10 ? Math.max(1, passwordScore(password)) : 0;
  return (
    <div id={id} className="grid gap-2.5 rounded-md bg-surface-sunken/70 p-3.5" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={cn('h-1.5 flex-1 rounded-pill bg-border', n <= score && BAR[score])}
            />
          ))}
        </div>
        <span className="min-w-16 text-right text-sm font-medium">
          <span className="sr-only">Password strength: </span>
          {password ? LABELS[score] : 'Strength'}
        </span>
      </div>
      <ul className="grid gap-1 text-sm">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(password, { email, names });
          return (
            <li
              key={rule.id}
              className={cn('flex items-center gap-2', ok ? 'text-success' : 'text-text-muted')}
            >
              {ok ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Circle aria-hidden="true" className="size-4" />
              )}
              <span>
                {rule.label}
                <span className="sr-only">{ok ? ' (met)' : ' (not met yet)'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
