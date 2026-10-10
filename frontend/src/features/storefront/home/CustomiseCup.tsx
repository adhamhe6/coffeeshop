import { Check, Milk, Sparkles, Thermometer } from 'lucide-react';
import { Button, Container, Reveal, SectionHeading } from '@/design';
import { Link } from 'react-router';

const GROUPS = [
  {
    icon: Sparkles,
    title: 'Size & shots',
    text: 'Small or large, single or double — the base price already includes your first shot.',
  },
  {
    icon: Milk,
    title: 'Milk & syrup',
    text: 'Whole, oat, almond, or none. Add a syrup if you like it sweeter.',
  },
  {
    icon: Thermometer,
    title: 'Hot, iced or extra hot',
    text: 'Tell us how you want it and we will pour it that way.',
  },
];

/** Decorative example of the option picker. Purely illustrative: hidden from assistive tech, copy on the left carries the message. */
function BuilderPreview() {
  const row = 'flex flex-wrap gap-2';
  const chip = 'rounded-pill border px-3.5 py-1.5 text-sm font-medium';
  const on = 'border-accent bg-accent-soft text-accent-text';
  const off = 'border-border-strong bg-surface-raised text-text-muted';
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-md rotate-[1.2deg] rounded-lg border border-border bg-surface-raised p-6 shadow-lg motion-reduce:rotate-0"
    >
      <p className="eyebrow text-text-muted">Example</p>
      <p className="mt-1 font-display text-2xl font-medium">Flat White</p>
      <dl className="mt-6 grid gap-5">
        <div>
          <dt className="mb-2 text-sm font-semibold">Size</dt>
          <dd className={row}>
            <span className={`${chip} ${off}`}>Small</span>
            <span className={`${chip} ${on} inline-flex items-center gap-1.5`}>
              <Check className="size-3.5" /> Large +$0.75
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-2 text-sm font-semibold">Milk</dt>
          <dd className={row}>
            <span className={`${chip} ${off}`}>Whole</span>
            <span className={`${chip} ${on} inline-flex items-center gap-1.5`}>
              <Check className="size-3.5" /> Oat +$0.60
            </span>
            <span className={`${chip} ${off}`}>Almond +$0.60</span>
          </dd>
        </div>
        <div>
          <dt className="mb-2 text-sm font-semibold">Extras</dt>
          <dd className={row}>
            <span className={`${chip} ${on} inline-flex items-center gap-1.5`}>
              <Check className="size-3.5" /> Extra shot +$0.80
            </span>
            <span className={`${chip} ${off}`}>Vanilla +$0.50</span>
          </dd>
        </div>
      </dl>
      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <span className="text-sm text-text-muted">Price updates as you choose</span>
        <span className="font-display text-xl font-semibold tabular-nums">$6.65</span>
      </div>
    </div>
  );
}

export function CustomiseCup() {
  return (
    <section
      aria-labelledby="customise-title"
      className="overflow-hidden bg-surface-sunken/55 py-20 lg:py-28"
    >
      <Container size="wide" className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
        <Reveal className="lg:col-span-6">
          <SectionHeading
            eyebrow="Customise your cup"
            title={<span id="customise-title">Every drink, built your way</span>}
            description="Pick the size, the milk, the shots and the sweetness. You see the price change as you choose, and the bar sees exactly what you asked for."
          />
          <ul className="mt-9 grid gap-5">
            {GROUPS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-raised text-accent-text shadow-xs ring-1 ring-border">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h3 className="font-sans text-base font-semibold">{title}</h3>
                  <p className="mt-0.5 text-[0.9375rem] text-text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
          <Button asChild size="lg" className="mt-10">
            <Link to="/menu">Start with a drink</Link>
          </Button>
        </Reveal>
        <Reveal delay={120} className="lg:col-span-6">
          <BuilderPreview />
        </Reveal>
      </Container>
    </section>
  );
}
