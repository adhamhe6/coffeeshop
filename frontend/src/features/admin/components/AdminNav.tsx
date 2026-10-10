import { NavLink } from 'react-router';
import { useAuth } from '@/app/auth';
import { cn } from '@/lib/cn';
import { visibleAdminNav } from '../nav';

/**
 * Capability-aware sidebar navigation: entries the staff member cannot use are not rendered.
 * `rail` (tablet widths): icons only, labels remain available to assistive tech and as tooltips.
 */
export function AdminNav({
  onNavigate,
  responsiveRail = false,
}: {
  onNavigate?: () => void;
  /** Collapse to an icon rail below `lg` (used by the persistent sidebar; the mobile drawer always shows labels). */
  responsiveRail?: boolean;
}) {
  const { hasCapability } = useAuth();
  const groups = visibleAdminNav(hasCapability);
  return (
    <nav
      aria-label="Admin"
      className={cn('grid gap-6 px-3 py-4', responsiveRail && 'max-lg:gap-3 max-lg:px-2')}
    >
      {groups.map((group) => (
        <div key={group.label}>
          <h2
            className={cn(
              'px-2.5 pb-1.5 font-sans text-[0.6875rem] font-semibold tracking-[0.12em] text-text-muted uppercase',
              responsiveRail && 'max-lg:sr-only',
            )}
          >
            {group.label}
          </h2>
          <ul className="grid gap-0.5">
            {group.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/admin'}
                  onClick={onNavigate}
                  title={responsiveRail ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-sunken hover:text-text',
                      responsiveRail && 'max-lg:size-10 max-lg:justify-center max-lg:px-0',
                      isActive &&
                        'bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text',
                    )
                  }
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className={cn(responsiveRail && 'max-lg:sr-only')}>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
