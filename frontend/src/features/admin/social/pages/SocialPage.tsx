import { TriangleAlert } from 'lucide-react';
import { ErrorState, Skeleton, socialLabel } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useAdminSocial } from '@/lib/api/adminMarketing';
import type { SocialPlatformKey } from '@/lib/api/peopleTypes';
import { AdminPageHeader } from '../../people-kit/AdminPageHeader';
import { SocialCard } from '../components/SocialCard';

/** Every platform the storefront can show, in default display order. */
const PLATFORMS: SocialPlatformKey[] = [
  'instagram',
  'tiktok',
  'facebook',
  'youtube',
  'pinterest',
  'x',
];

export default function SocialPage() {
  useSeo({ title: 'Social links', noindex: true });
  const query = useAdminSocial();
  const profiles = query.data ?? [];
  const placeholders = profiles.filter((p) => p.is_placeholder);
  const nextOrder = (profiles.reduce((max, p) => Math.max(max, p.sort_order ?? 0), 0) || 0) + 10;

  return (
    <div>
      <AdminPageHeader
        title="Social links"
        description="The profiles shown in the website footer. Only web addresses starting with http:// or https:// are accepted."
      />
      {placeholders.length > 0 ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-3 rounded-lg border border-warning/50 bg-warning-bg p-4"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {placeholders.length} social link{placeholders.length === 1 ? ' is a' : 's are'}{' '}
              placeholder
              {placeholders.length === 1 ? '' : 's'} — replace before launch
            </p>
            <p className="mt-1 text-sm">
              {placeholders.map((p) => socialLabel(p.platform)).join(', ')}. Visitors who tap these
              go to a demo address, not your real profile.
            </p>
          </div>
        </div>
      ) : null}
      {query.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <SocialCard
              key={platform}
              platform={platform}
              profile={profiles.find((p) => p.platform === platform)}
              nextOrder={nextOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
}
