import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { useBranches } from '@/lib/api/branches';
import { activeSocialLinks, useStore } from '@/lib/api/store';
import { todayHoursText } from '@/lib/hours';
import { Badge, Container, Logo, SocialIcon, socialLabel } from '@/design';
import { LEGAL_NAV, PRIMARY_NAV, SUPPORT_NAV } from '../nav';
import { NewsletterForm } from './NewsletterForm';

const linkClass =
  'rounded-xs text-[0.9375rem] text-text-inverse-muted underline-offset-4 transition-colors hover:text-text-inverse hover:underline';

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="eyebrow mb-4 font-sans text-text-inverse-muted">{title}</h2>
      {children}
    </div>
  );
}

export function Footer() {
  const { data: store } = useStore();
  const { data: branches } = useBranches();
  const { pathname } = useLocation();
  const social = activeSocialLinks(store);
  const brand = store?.brand_name ?? 'Lantern Coffee Roasters';
  // The home page has its own, larger newsletter section.
  const showNewsletter = pathname !== '/';

  return (
    <footer data-surface="dark" className="mt-auto bg-surface-inverse text-text-inverse">
      <Container size="wide" className="pt-16 pb-8">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Link
              to="/"
              aria-label={`${brand}, home`}
              className="inline-block rounded-md text-text-inverse"
            >
              <Logo title="" className="h-11 w-auto" />
            </Link>
            <p className="mt-5 max-w-sm text-[0.9375rem] leading-relaxed text-text-inverse-muted">
              {store?.tagline ?? 'Slow-roasted. Carefully poured.'} Small-batch coffee, roasted
              every week and made the way you like it.
            </p>
            {social.length > 0 ? (
              <ul className="mt-6 flex flex-wrap gap-2" aria-label="Social media">
                {social.map((s) => (
                  <li key={s.platform}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${brand} on ${socialLabel(s.platform)} (opens in a new tab)`}
                      className="flex size-11 items-center justify-center rounded-md border border-white/20 text-text-inverse transition-colors hover:bg-white/10"
                    >
                      <SocialIcon platform={s.platform} className="size-5" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid gap-10 sm:grid-cols-3 lg:col-span-8">
            <Column title="Shop">
              <ul className="grid gap-2.5">
                {PRIMARY_NAV.filter((n) => n.label !== 'About').map((n) => (
                  <li key={n.to}>
                    <Link to={n.to} className={linkClass}>
                      {n.label === 'Beans' ? 'Beans & merch' : n.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/favorites" className={linkClass}>
                    Favorites
                  </Link>
                </li>
              </ul>
            </Column>
            <Column title="Support">
              <ul className="grid gap-2.5">
                {SUPPORT_NAV.map((n) => (
                  <li key={n.to}>
                    <Link to={n.to} className={linkClass}>
                      {n.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/account/orders" className={linkClass}>
                    Track an order
                  </Link>
                </li>
              </ul>
              {store?.support_email || store?.support_phone ? (
                <ul className="mt-5 grid gap-2 text-sm text-text-inverse-muted">
                  {store.support_email ? (
                    <li className="flex items-center gap-2">
                      <Mail aria-hidden="true" className="size-4" />
                      <a
                        className="underline-offset-4 hover:text-text-inverse hover:underline"
                        href={`mailto:${store.support_email}`}
                      >
                        {store.support_email}
                      </a>
                    </li>
                  ) : null}
                  {store.support_phone ? (
                    <li className="flex items-center gap-2">
                      <Phone aria-hidden="true" className="size-4" />
                      <a
                        className="underline-offset-4 hover:text-text-inverse hover:underline"
                        href={`tel:${store.support_phone.replace(/[^+\d]/g, '')}`}
                      >
                        {store.support_phone}
                      </a>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </Column>
            <Column title="Visit">
              {branches && branches.length > 0 ? (
                <ul className="grid gap-4">
                  {branches.slice(0, 3).map((b) => (
                    <li key={b.id} className="text-sm">
                      <p className="flex items-center gap-2 font-medium text-text-inverse">
                        <MapPin aria-hidden="true" className="size-4 text-accent-on-dark" />
                        {b.name}
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-text-inverse-muted">
                        <Clock aria-hidden="true" className="size-4" />
                        <span>{todayHoursText(b)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-inverse-muted">
                  Opening hours are on the locations page.
                </p>
              )}
              <Link to="/locations" className={`${linkClass} mt-4 inline-block`}>
                All locations &amp; hours
              </Link>
            </Column>
          </div>
        </div>

        {showNewsletter ? (
          <div className="mt-14 grid gap-4 border-t border-white/15 pt-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <h2 className="font-display text-h3 font-medium">Letters from the roastery</h2>
              <p className="mt-2 text-[0.9375rem] text-text-inverse-muted">
                New roasts, seasonal drinks and the occasional offer. No noise.
              </p>
            </div>
            <NewsletterForm tone="dark" className="lg:col-span-6 lg:col-start-7" />
          </div>
        ) : null}

        <div className="mt-14 flex flex-col gap-4 border-t border-white/15 pt-6 text-sm text-text-inverse-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {brand}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LEGAL_NAV.map((n) => (
              <Link key={n.to} to={n.to} className={`${linkClass} !text-sm`}>
                {n.label}
              </Link>
            ))}
            <Link to="/refund-policy" className={`${linkClass} !text-sm`}>
              Refunds
            </Link>
            {store?.social?.some((s) => s.is_placeholder) ? (
              <Badge tone="outline" className="border-white/30 text-text-inverse-muted">
                Demo links
              </Badge>
            ) : null}
          </div>
        </div>
      </Container>
    </footer>
  );
}
