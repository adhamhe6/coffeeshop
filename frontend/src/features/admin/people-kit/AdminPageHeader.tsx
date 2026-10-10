import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';

interface AdminPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Link back to the parent list. */
  back?: { to: string; label: string };
  meta?: ReactNode;
}

/** Page title block shared by the people / marketing / configuration admin pages. One `h1` per page. */
export function AdminPageHeader({ title, description, actions, back, meta }: AdminPageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {back ? (
          <Link
            to={back.to}
            className="mb-1.5 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-text-muted hover:text-text"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {back.label}
          </Link>
        ) : null}
        <h1 className="font-display text-h2 leading-tight text-text">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-[70ch] text-[0.9375rem] text-text-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
