import { Link } from 'react-router';
import { Heart } from 'lucide-react';
import { useFavorites } from '@/hooks/useFavorites';
import { Button } from '@/design';

export function FavoritesLink() {
  const { count } = useFavorites();
  const label = count > 0 ? `Favorites, ${count} saved` : 'Favorites';
  return (
    <div className="relative">
      <Button asChild variant="ghost" size="icon">
        <Link to="/favorites" aria-label={label}>
          <Heart aria-hidden="true" className="size-[1.375rem]" />
        </Link>
      </Button>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-espresso px-1 text-[0.6875rem] leading-none font-semibold text-cream tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </div>
  );
}
