import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Bell, MapPin, Package, User } from 'lucide-react';
import { Container } from '@/design';
import { cn } from '@/lib/cn';

const LINKS = [
  { to: '/account', label: 'Profile', icon: User, end: true },
  { to: '/account/orders', label: 'Orders', icon: Package, end: false },
  { to: '/account/addresses', label: 'Addresses', icon: MapPin, end: false },
  { to: '/account/notifications', label: 'Notifications', icon: Bell, end: false },
] as const;

/** Shared frame for the account area: page title and a section nav that stays usable on a phone. */
export function AccountShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Container size="default" className="py-8 md:py-12">
      <p className="eyebrow text-text-muted">Your account</p>
      <div className="mt-1 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2">{title}</h1>
          {description ? <p className="mt-2 max-w-prose text-text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      <nav aria-label="Account sections" className="mb-8 border-b border-border">
        <ul className="flex scrollbar-none gap-1 overflow-x-auto">
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="shrink-0">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-3.5 text-[0.9375rem] font-medium transition-colors',
                    isActive
                      ? 'border-accent text-text'
                      : 'border-transparent text-text-muted hover:text-text',
                  )
                }
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </Container>
  );
}
