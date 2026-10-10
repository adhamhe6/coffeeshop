import type { ReactNode } from 'react';

interface SectionCardProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/** One editor section: anchor target for the in-page nav, with its own heading. */
export function SectionCard({ id, title, description, children }: SectionCardProps) {
  return (
    <section
      id={`section-${id}`}
      aria-labelledby={`section-${id}-title`}
      className="scroll-mt-32 rounded-lg border border-border bg-surface-raised"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 id={`section-${id}-title`} className="font-display text-h4 font-semibold">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}
