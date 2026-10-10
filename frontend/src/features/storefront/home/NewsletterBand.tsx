import { Link } from 'react-router';
import type { ContentBlock } from '@/lib/api/types';
import { Container, LogoGlyph, Reveal } from '@/design';
import { NewsletterForm } from '../components/NewsletterForm';

export function NewsletterBand({ block }: { block?: ContentBlock }) {
  return (
    <section aria-labelledby="newsletter-title" className="py-20 lg:py-28">
      <Container size="wide">
        <Reveal className="relative isolate overflow-hidden rounded-lg border border-border bg-surface-raised px-6 py-14 sm:px-12 lg:px-16 lg:py-20">
          <LogoGlyph
            variant="mono"
            className="absolute -right-8 -bottom-10 -z-10 h-80 w-auto text-surface-sunken"
          />
          <div className="max-w-xl">
            <p className="eyebrow text-accent-text">{block?.eyebrow || 'The newsletter'}</p>
            <h2 id="newsletter-title" className="mt-4 text-h2">
              {block?.title || 'Letters from the roastery'}
            </h2>
            <p className="mt-4 text-[1.0625rem] text-text-muted">
              New roasts, seasonal drinks and the occasional offer. A few emails a month, never
              noise.
            </p>
            <NewsletterForm className="mt-8" />
            <p className="mt-4 text-sm text-text-muted">
              We use your email only to send the newsletter. Read our{' '}
              <Link
                to="/privacy"
                className="rounded-xs font-medium text-accent-text underline underline-offset-4"
              >
                privacy policy
              </Link>
              .
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
