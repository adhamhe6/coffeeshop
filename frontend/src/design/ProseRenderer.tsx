import type { ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

const isExternal = (href: string | undefined) => !!href && /^https?:\/\//i.test(href);

const components: Components = {
  a({ href, children, ...rest }) {
    const external = isExternal(href);
    return (
      <a
        {...rest}
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
        {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
      </a>
    );
  },
  img({ src, alt }) {
    // CMS content may reference images; keep them constrained and lazy.
    return <img src={src} alt={alt ?? ''} loading="lazy" className="rounded-md" />;
  },
};

/**
 * Markdown → React. `skipHtml` drops any raw HTML in the source; no rehype-raw is installed, so CMS content
 * can never inject markup or scripts. Unsafe URL protocols (javascript:) are stripped by react-markdown.
 */
export default function ProseRenderer({
  children,
  className,
}: { children: string } & Pick<ComponentProps<'div'>, 'className'>) {
  return (
    <div
      className={cn(
        'prose-lantern max-w-[68ch] text-[1.0625rem] leading-[1.75] text-text',
        '[&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:decoration-2',
        '[&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-5 [&_blockquote]:font-display [&_blockquote]:text-xl [&_blockquote]:text-text-muted [&_blockquote]:italic',
        '[&_code]:rounded-xs [&_code]:bg-surface-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em]',
        '[&_h1]:mt-10 [&_h1]:mb-4 [&_h1]:text-h1 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-h2 [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-h3 [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-h4 [&_h4]:font-semibold',
        '[&_hr]:my-10 [&_hr]:border-border',
        '[&_img]:my-6 [&_li]:my-1.5 [&_li::marker]:text-accent-text [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_strong]:font-semibold [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6',
        '[&_table]:my-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[0.9375rem] [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border [&_th]:bg-surface-sunken [&_th]:px-3 [&_th]:py-2 [&_th]:text-left',
        '[&>:first-child]:mt-0',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
