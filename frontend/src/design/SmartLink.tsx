import type { ComponentProps } from 'react';
import { Link } from 'react-router';
import { isExternalUrl, isSafeLink } from '@/lib/nav';

interface SmartLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  /** Internal path (`/menu`) or http(s) URL — typically from CMS content. Unsafe values render as plain text. */
  to: string | null | undefined;
}

/**
 * Router link for internal paths, plain anchor with `rel="noopener noreferrer"` for external URLs.
 * Anything else (e.g. `javascript:` from a bad CMS entry) renders its children without a link.
 */
export function SmartLink({ to, children, ...props }: SmartLinkProps) {
  if (!isSafeLink(to)) return <span className={props.className}>{children}</span>;
  if (isExternalUrl(to)) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} {...(props as Omit<ComponentProps<typeof Link>, 'to'>)}>
      {children}
    </Link>
  );
}
