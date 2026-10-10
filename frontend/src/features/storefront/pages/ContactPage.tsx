import { Link } from 'react-router';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { useSeo } from '@/hooks/useSeo';
import { useBranches } from '@/lib/api/branches';
import { useStore } from '@/lib/api/store';
import { todayHoursText } from '@/lib/hours';
import { Button, Container, ErrorState, SectionHeading, Skeleton } from '@/design';

/**
 * Contact details from store settings and branch hours. The backend has no contact-form endpoint, so there is
 * deliberately no form: email and phone are real links, and.
 */
export default function ContactPage() {
  const store = useStore();
  const branches = useBranches();
  useSeo({
    title: 'Contact us',
    description: `How to reach ${store.data?.brand_name ?? 'Lantern Coffee Roasters'}: email, phone, address and opening hours.`,
  });

  const email = store.data?.support_email;
  const phone = store.data?.support_phone;
  const address = store.data?.business_address;
  const subject = encodeURIComponent(
    `Question for ${store.data?.brand_name ?? 'Lantern Coffee Roasters'}`,
  );

  return (
    <Container size="wide" className="py-12 lg:py-16">
      <SectionHeading
        as="h1"
        eyebrow="Get in touch"
        title="Contact us"
        description="Questions about an order, a branch or a bag of beans? Write or call and a person will reply."
      />
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <section
          aria-labelledby="contact-details"
          className="grid content-start gap-6 rounded-lg border border-border bg-surface-raised p-6 lg:p-8"
        >
          <h2 id="contact-details" className="font-display text-h3 font-medium">
            Support
          </h2>
          {store.isPending ? (
            <div className="grid gap-3" aria-busy="true">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          ) : store.isError ? (
            <ErrorState
              error={store.error}
              onRetry={() => void store.refetch()}
              retrying={store.isFetching}
              className="py-4"
            />
          ) : (
            <ul className="grid gap-5 text-[1.0625rem]">
              {email ? (
                <li className="flex items-start gap-3">
                  <Mail aria-hidden="true" className="mt-1 size-5 shrink-0 text-accent-text" />
                  <div>
                    <p className="text-sm text-text-muted">Email</p>
                    <a
                      href={`mailto:${email}?subject=${subject}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {email}
                    </a>
                  </div>
                </li>
              ) : null}
              {phone ? (
                <li className="flex items-start gap-3">
                  <Phone aria-hidden="true" className="mt-1 size-5 shrink-0 text-accent-text" />
                  <div>
                    <p className="text-sm text-text-muted">Phone</p>
                    <a
                      href={`tel:${phone.replace(/[^+\d]/g, '')}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {phone}
                    </a>
                  </div>
                </li>
              ) : null}
              {address ? (
                <li className="flex items-start gap-3">
                  <MapPin aria-hidden="true" className="mt-1 size-5 shrink-0 text-accent-text" />
                  <div>
                    <p className="text-sm text-text-muted">Registered address</p>
                    <p className="font-medium">{address}</p>
                  </div>
                </li>
              ) : null}
              {!email && !phone && !address ? (
                <li className="text-text-muted">
                  Contact details have not been published yet. Please visit a branch.
                </li>
              ) : null}
            </ul>
          )}
          <p className="text-sm text-text-muted">
            For order questions, include your order number so we can find it quickly.{' '}
            <Link to="/faq" className="underline underline-offset-4">
              The FAQ
            </Link>{' '}
            answers the most common ones.
          </p>
          {email ? (
            <Button asChild className="justify-self-start">
              <a href={`mailto:${email}?subject=${subject}`}>Email us</a>
            </Button>
          ) : null}
        </section>

        <section aria-labelledby="contact-hours" className="grid content-start gap-5">
          <h2 id="contact-hours" className="font-display text-h3 font-medium">
            Branch hours today
          </h2>
          {branches.isPending ? (
            <Skeleton className="h-40" />
          ) : branches.isError ? (
            <ErrorState
              error={branches.error}
              onRetry={() => void branches.refetch()}
              retrying={branches.isFetching}
              className="py-4"
            />
          ) : (
            <ul className="grid gap-3">
              {(branches.data ?? []).map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border border-border bg-surface-raised p-4"
                >
                  <div>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-sm text-text-muted">
                      {b.address_line}, {b.city}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="flex items-center justify-end gap-1.5 font-medium">
                      <Clock aria-hidden="true" className="size-4" /> {todayHoursText(b)}
                    </p>
                    {b.phone ? (
                      <a
                        href={`tel:${b.phone.replace(/[^+\d]/g, '')}`}
                        className="text-text-muted underline-offset-4 hover:underline"
                      >
                        {b.phone}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="link" className="justify-self-start">
            <Link to="/locations">Full opening hours and delivery areas</Link>
          </Button>
        </section>
      </div>
    </Container>
  );
}
