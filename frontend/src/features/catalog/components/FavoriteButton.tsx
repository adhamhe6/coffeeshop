import { Heart } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/cn';
import { loginUrl } from '@/lib/nav';
import { useAuth } from '@/app/auth';
import { useFavorites } from '@/hooks/useFavorites';
import { toast } from '@/design';

interface FavoriteButtonProps {
  productId: number;
  productName: string;
  className?: string;
}

const NUDGE_KEY = 'lantern.favorites.nudged';

/** The sign-in nudge is shown once per browser session, not on every heart. */
function takeNudge(): boolean {
  try {
    if (window.sessionStorage.getItem(NUDGE_KEY)) return false;
    window.sessionStorage.setItem(NUDGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Heart toggle (signed-in: server with optimistic update, anonymous: localStorage). `aria-pressed` carries the
 * state; every toggle confirms with a toast (with Undo), and anonymous visitors are told once how to keep them.
 */
export function FavoriteButton({ productId, productName, className }: FavoriteButtonProps) {
  const { isFavorite, toggle } = useFavorites();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const on = isFavorite(productId);

  const onClick = () => {
    toggle(productId);
    const id = `favorite-${productId}`;
    if (on) {
      toast.success(`Removed ${productName} from favorites`, {
        id,
        action: { label: 'Undo', onClick: () => toggle(productId) },
      });
    } else if (!isAuthenticated && takeNudge()) {
      toast.success(`Saved ${productName} on this device`, {
        id,
        description: 'Sign in to keep your favorites on every device.',
        action: { label: 'Sign in', onClick: () => navigate(loginUrl('/favorites')) },
      });
    } else {
      toast.success(`Saved ${productName} to favorites`, {
        id,
        action: { label: 'View', onClick: () => navigate('/favorites') },
      });
    }
  };

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${productName} from favorites` : `Save ${productName} to favorites`}
      onClick={onClick}
      className={cn(
        'flex size-11 items-center justify-center rounded-full bg-surface-raised/90 text-text shadow-xs backdrop-blur transition-[transform,background-color] hover:bg-surface-raised active:scale-95 sm:size-10',
        className,
      )}
    >
      <Heart
        aria-hidden="true"
        className={cn('size-[1.125rem] transition-colors', on && 'fill-accent text-accent')}
      />
    </button>
  );
}
