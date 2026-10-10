import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useStore } from '@/lib/api/store';
import { SmartLink } from '@/design';

const KEY = 'lantern.announcement.dismissed';

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Thin banner above the header, content from `store/` (`announcement`). Dismissal lasts for the browser session. */
export function AnnouncementBar() {
  const { data } = useStore();
  const announcement = data?.announcement;
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed());

  if (!announcement?.message || dismissed === announcement.message) return null;

  const dismiss = () => {
    setDismissed(announcement.message);
    try {
      window.sessionStorage.setItem(KEY, announcement.message);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      data-surface="dark"
      className="relative bg-surface-inverse text-text-inverse"
      role="region"
      aria-label="Announcement"
    >
      <div className="mx-auto flex min-h-10 max-w-[92rem] items-center justify-center gap-3 px-12 py-2 text-center text-[0.8125rem] leading-snug">
        {announcement.link_url ? (
          <SmartLink
            to={announcement.link_url}
            className="group inline-flex items-center gap-2 font-medium underline-offset-4 hover:underline"
          >
            {announcement.message}
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </SmartLink>
        ) : (
          <p className="font-medium">{announcement.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-text-inverse-muted hover:bg-white/10 hover:text-text-inverse"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
