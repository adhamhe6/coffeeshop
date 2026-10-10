import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Prose } from './Prose';

describe('Prose (CMS markdown)', () => {
  it('renders markdown structure', async () => {
    render(<Prose>{'## Hours\n\n- Mon\n- Tue\n\n**bold** and [link](/menu)'}</Prose>);
    expect(await screen.findByRole('heading', { name: 'Hours', level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', '/menu');
  });

  it('never renders raw HTML or scripts from content', async () => {
    const { container } = render(
      <Prose>
        {
          'Hello <script>window.__pwned = 1</script><img src=x onerror="window.__pwned=1"> <b>raw</b>\n\n<div class="x">block</div>'
        }
      </Prose>,
    );
    await screen.findByText(/Hello/);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('div.x')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('strips javascript: URLs and hardens external links', async () => {
    render(<Prose>{'[bad](javascript:alert(1)) and [ext](https://example.com)'}</Prose>);
    const ext = await screen.findByRole('link', { name: /ext/ });
    expect(ext).toHaveAttribute('target', '_blank');
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer');
    const bad = screen.getByText('bad');
    expect(bad.closest('a')?.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
  });
});
