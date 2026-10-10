import { Link } from 'react-router';
import { ArrowRight, Clock, Flame, ShoppingBag, Sprout } from 'lucide-react';
import type { Branch, ContentBlock } from '@/lib/api/types';
import { todayHoursText } from '@/lib/hours';
import { Button, Container, LogoGlyph, ProductImage, SmartLink } from '@/design';

interface HeroProps {
  block?: ContentBlock;
  branch?: Branch;
  loading?: boolean;
}

/** Last word set in the display italic: a typographic accent that works for any CMS headline. */
function Headline({ text }: { text: string }) {
  // Italicise the last word that has at least four letters ("Coffee worth slowing *down* for.").
  const words = text.trim().split(' ');
  let idx = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if ((words[i] ?? '').replace(/[^\p{L}]/gu, '').length >= 4) {
      idx = i;
      break;
    }
  }
  if (idx < 0 || words.length < 2) return <>{text}</>;
  return (
    <>
      {words.slice(0, idx).join(' ')}{' '}
      <em className="font-normal text-accent-text italic">{words[idx]}</em>
      {idx < words.length - 1 ? ` ${words.slice(idx + 1).join(' ')}` : ''}
    </>
  );
}

const FACTS = [
  { icon: ShoppingBag, label: 'Order ahead for pickup' },
  { icon: Flame, label: 'Roasted in small batches' },
  { icon: Sprout, label: 'Sourced with care' },
];

export function Hero({ block, branch, loading }: HeroProps) {
  const title = block?.title || 'Coffee worth slowing down for.';
  const body =
    block?.body ||
    'Small-batch roasting, a short menu and drinks made the way you like them. Order ahead and your cup is waiting.';
  const ctaLabel = block?.cta_label || 'Order for pickup';
  const ctaUrl = block?.cta_url || '/menu';

  return (
    <section aria-labelledby="home-hero-title" className="relative overflow-hidden">
      <Container
        size="wide"
        className="grid gap-12 pt-8 pb-14 sm:pt-12 lg:grid-cols-12 lg:items-center lg:gap-10 lg:pt-16 lg:pb-24"
      >
        <div className="lg:col-span-6 xl:col-span-6">
          <p className="eyebrow flex items-center gap-3 text-accent-text">
            <span aria-hidden="true" className="h-px w-10 bg-accent" />
            {block?.eyebrow || 'Small-batch roasters'}
          </p>
          <h1 id="home-hero-title" className="mt-6 text-display">
            <Headline text={title} />
          </h1>
          <p className="mt-6 max-w-xl text-lead text-text-muted">{body}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="w-full sm:w-auto"
              trailingIcon={<ArrowRight aria-hidden="true" className="size-4" />}
            >
              <SmartLink to={ctaUrl}>{ctaLabel}</SmartLink>
            </Button>
            <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
              <Link to="/menu?seasonal=true">See the seasonal menu</Link>
            </Button>
          </div>
          <ul className="mt-10 flex flex-wrap gap-x-7 gap-y-3 border-t border-border pt-6 text-sm font-medium text-text-muted">
            {FACTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4 text-accent-text" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative lg:col-span-6">
          <div
            aria-hidden="true"
            className="absolute -top-5 -right-3 hidden h-full w-[88%] rounded-lg bg-surface-sunken sm:block lg:-right-6"
          />
          <div className="relative">
            {block?.image || loading ? (
              <ProductImage
                src={block?.image}
                alt=""
                priority
                aspect="5/4"
                width={1200}
                height={960}
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="rounded-lg shadow-md lg:aspect-[6/6.4]"
              />
            ) : (
              <div className="relative flex aspect-[5/4] items-center justify-center overflow-hidden rounded-lg bg-surface-inverse text-cream shadow-md lg:aspect-[6/6.4]">
                <span
                  aria-hidden="true"
                  className="absolute size-[135%] rounded-full border border-white/10"
                />
                <span
                  aria-hidden="true"
                  className="absolute size-[95%] rounded-full border border-white/10"
                />
                <span
                  aria-hidden="true"
                  className="absolute size-[58%] rounded-full border border-white/10"
                />
                <LogoGlyph variant="color" className="relative h-1/2 w-auto" />
              </div>
            )}
            {branch ? (
              <div className="mt-4 max-w-[17rem] rounded-lg border border-border bg-surface-raised p-4 shadow-md sm:absolute sm:-bottom-6 sm:left-6 sm:mt-0 lg:-left-8">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Clock aria-hidden="true" className="size-4 text-accent-text" />
                  {branch.is_open_now ? 'Open now' : 'Opening hours'}
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  {branch.name} · {todayHoursText(branch)}
                </p>
                <Link
                  to="/locations"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-text underline-offset-4 hover:underline"
                >
                  All locations <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </Container>
    </section>
  );
}
