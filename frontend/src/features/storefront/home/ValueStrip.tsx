import { Coffee, Leaf, ShoppingBag, SlidersHorizontal } from 'lucide-react';
import { Container } from '@/design';

const VALUES = [
  { icon: Leaf, title: 'Traceable beans', text: 'Every bag names its farm and producer.' },
  { icon: Coffee, title: 'Roasted weekly', text: 'Small lots, so it is never old.' },
  {
    icon: SlidersHorizontal,
    title: 'Made your way',
    text: 'Size, milk, shots and syrup — your call.',
  },
  { icon: ShoppingBag, title: 'Pickup or delivery', text: 'Order ahead and skip the line.' },
];

/** Hairline-bordered trust strip under the hero. Static brand copy. */
export function ValueStrip() {
  return (
    <section aria-label="Why Lantern" className="border-y border-border bg-surface-raised/60">
      <Container size="wide">
        <ul className="grid grid-cols-2 divide-x divide-border lg:grid-cols-4">
          {VALUES.map(({ icon: Icon, title, text }, i) => (
            <li
              key={title}
              className={`flex flex-col gap-2 px-4 py-6 sm:flex-row sm:items-start sm:gap-4 lg:px-8 ${i >= 2 ? 'border-t border-border lg:border-t-0' : ''} ${i === 0 ? 'lg:pl-0' : ''}`}
            >
              <Icon
                aria-hidden="true"
                className="size-6 shrink-0 text-accent-text"
                strokeWidth={1.6}
              />
              <div>
                <h2 className="font-sans text-[0.9375rem] font-semibold">{title}</h2>
                <p className="mt-0.5 text-sm text-text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
