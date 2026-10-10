import type { ReactNode, SVGProps } from 'react';
import type { SocialPlatform } from '@/lib/api/types';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const paths: Record<SocialPlatform, ReactNode> = {
  instagram: (
    <g {...stroke}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r=".6" fill="currentColor" />
    </g>
  ),
  facebook: (
    <path
      {...stroke}
      d="M14 8.5h2.5V5H14a3.5 3.5 0 0 0-3.5 3.5V11H8v3.5h2.5V21H14v-6.5h2.4l.6-3.5H14V8.8c0-.2.1-.3.3-.3Z"
    />
  ),
  youtube: (
    <g {...stroke}>
      <rect x="2.8" y="5.5" width="18.4" height="13" rx="4" />
      <path d="m10.2 9.3 4.6 2.7-4.6 2.7Z" fill="currentColor" />
    </g>
  ),
  tiktok: <path {...stroke} d="M14 3.5v11a3.5 3.5 0 1 1-3.5-3.5M14 3.5c.3 2.2 1.8 3.8 4 4" />,
  pinterest: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m11 17.5 1.3-5.5M10 11.2c0-1.2.9-2 2-2s2 .8 2 1.9-.9 2-2.2 2" />
    </g>
  ),
  x: <path {...stroke} d="M4.5 4.5 19.5 19.5M19.5 4.5l-15 15" />,
};

const LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  x: 'X',
};

export const socialLabel = (p: string) => LABELS[p as SocialPlatform] ?? p;

export function SocialIcon({ platform, ...props }: { platform: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      {paths[platform as SocialPlatform] ?? paths.x}
    </svg>
  );
}
