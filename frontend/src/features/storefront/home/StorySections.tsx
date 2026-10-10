import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ContentBlock } from '@/lib/api/types';
import { Button, Container, ProductImage, Reveal, SmartLink } from '@/design';

interface StoryRowProps {
  block?: ContentBlock;
  fallback: { eyebrow: string; title: string; body: string; cta_label: string; cta_url: string };
  flip?: boolean;
  id: string;
}

function StoryRow({ block, fallback, flip, id }: StoryRowProps) {
  const b = {
    ...fallback,
    ...Object.fromEntries(Object.entries(block ?? {}).filter(([, v]) => v)),
  } as typeof fallback & ContentBlock;
  const paragraphs = b.body.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
      <Reveal className={cn('lg:col-span-6', flip ? 'lg:order-2' : 'lg:col-start-1')}>
        <ProductImage
          src={block?.image}
          alt=""
          aspect="4/5"
          sizes="(min-width: 1024px) 45vw, 100vw"
          className={cn('rounded-lg lg:aspect-[5/5.4]', flip ? 'lg:ml-10' : 'lg:mr-10')}
        />
      </Reveal>
      <Reveal delay={100} className={cn('lg:col-span-5', flip ? 'lg:order-1' : 'lg:col-start-8')}>
        <p className="eyebrow text-accent-text">{b.eyebrow}</p>
        <h2 id={id} className="mt-4 text-h2">
          {b.title}
        </h2>
        <div className="mt-5 grid gap-4 text-[1.0625rem] leading-relaxed text-text-muted">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {b.cta_url ? (
          <Button
            asChild
            variant="link"
            className="mt-7"
            trailingIcon={<ArrowRight aria-hidden="true" className="size-4" />}
          >
            <SmartLink to={b.cta_url}>{b.cta_label || 'Learn more'}</SmartLink>
          </Button>
        ) : null}
      </Reveal>
    </div>
  );
}

/** Brand story + sourcing, editable in the CMS as blocks `home.story` and `home.sourcing`. */
export function StorySections({ blocks }: { blocks: Record<string, ContentBlock> }) {
  return (
    <section aria-label="Our story and sourcing" className="py-20 lg:py-28">
      <Container size="wide" className="grid gap-24 lg:gap-32">
        <StoryRow
          id="story-title"
          block={blocks['home.story']}
          fallback={{
            eyebrow: 'Our story',
            title: 'A roastery with the lights on',
            body: 'We started with one small roaster and a simple idea: coffee tastes better when someone cares about every step.\n\nToday we still roast in small lots every week, pour every cup by hand and keep the menu short enough to do it well.',
            cta_label: 'Read our story',
            cta_url: '/about',
          }}
        />
        <StoryRow
          id="sourcing-title"
          flip
          block={blocks['home.sourcing']}
          fallback={{
            eyebrow: 'Sourcing',
            title: 'Coffee we can name the farm of',
            body: 'We buy from producers we can name and pay fairly so they can keep growing great coffee.\n\nEvery bag tells you where it came from, who grew it and how we roasted it.',
            cta_label: 'Shop beans',
            cta_url: '/menu?type=BEANS',
          }}
        />
      </Container>
    </section>
  );
}
