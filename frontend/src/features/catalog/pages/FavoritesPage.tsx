import { Link } from 'react-router';
import { Heart } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useFavorites } from '@/hooks/useFavorites';
import { useSeo } from '@/hooks/useSeo';
import { writeLocalFavorites } from '@/lib/favoritesStorage';
import { loginUrl } from '@/lib/nav';
import { Button, Container, EmptyState, ErrorState, SectionHeading, toast } from '@/design';
import { useFavoriteProducts, useProductsByIds } from '../api';
import { ProductCard } from '../components/ProductCard';
import { ResultsSkeleton } from '../components/ResultsGrid';
import { NoResults } from '../components/NoResults';
import { useSelectedBranch } from '../useSelectedBranch';

/** `/favorites`: saved products. Signed in: from the account (`favorites/`); anonymous: ids in localStorage resolved via `products/?ids=`. */
export default function FavoritesPage() {
  useSeo({ title: 'Favorites', noindex: true });
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { ids, isFavorite, toggle } = useFavorites();
  const { branchSlug, isReady } = useSelectedBranch();

  const server = useFavoriteProducts(branchSlug, isAuthenticated && isReady);
  const local = useProductsByIds(ids, branchSlug, !isAuthenticated && isReady && !authLoading);
  const query = isAuthenticated ? server : local;

  const products = (query.data ?? []).filter((p) => isFavorite(p.id));
  const loading = authLoading || !isReady || (ids.length > 0 && query.isPending);
  // Anonymous ids that did not resolve (product retired): offer to tidy them away.
  const orphaned =
    !isAuthenticated && local.isSuccess
      ? ids.filter((id) => !(local.data ?? []).some((p) => p.id === id))
      : [];

  return (
    <Container size="wide" className="py-12 lg:py-16">
      <SectionHeading
        as="h1"
        eyebrow="Saved for later"
        title="Favorites"
        description={
          products.length
            ? `${products.length} ${products.length === 1 ? 'item' : 'items'} you love, ready to order.`
            : 'Tap the heart on anything you want to find again.'
        }
      />

      {!authLoading && !isAuthenticated && ids.length > 0 ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised p-5">
          <p className="max-w-xl text-[0.9375rem]">
            <span className="font-medium">Saved on this device only.</span>{' '}
            <span className="text-text-muted">
              Sign in and your favorites follow you to every phone and laptop.
            </span>
          </p>
          <div className="flex gap-3">
            <Button asChild>
              <Link to={loginUrl('/favorites')}>Sign in</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/register">Create account</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-10" aria-busy={loading || undefined}>
        {query.isError && ids.length + (isAuthenticated ? 1 : 0) > 0 ? (
          <ErrorState
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : loading ? (
          <ResultsSkeleton count={4} />
        ) : products.length === 0 ? (
          <>
            <EmptyState
              icon={<Heart aria-hidden="true" />}
              title="No favorites yet"
              description="Heart a drink, a bake or a bag of beans and it will wait for you here."
              action={
                <Button asChild>
                  <Link to="/menu">Browse the menu</Link>
                </Button>
              }
            />
            <NoResultsFallback />
          </>
        ) : (
          <>
            <h2 className="sr-only">Your saved items</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
              {products.map((p) => (
                <li key={p.id} className="flex flex-col">
                  <ProductCard product={p} aspect="1/1" showAdd />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 self-start px-2 text-text-muted"
                    onClick={() => toggle(p.id)}
                    aria-label={`Remove ${p.name} from favorites`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        {orphaned.length > 0 ? (
          <p className="mt-10 text-sm text-text-muted">
            {orphaned.length} saved {orphaned.length === 1 ? 'item is' : 'items are'} no longer on
            the menu.{' '}
            <Button
              variant="link"
              onClick={() => {
                writeLocalFavorites(ids.filter((id) => !orphaned.includes(id)));
                toast.success('Removed items that are no longer available');
              }}
            >
              Remove {orphaned.length === 1 ? 'it' : 'them'}
            </Button>
          </p>
        ) : null}
      </div>
    </Container>
  );
}

/** Popular suggestions under the empty state (reuses the no-results block without its heading). */
function NoResultsFallback() {
  return (
    <div className="mt-6">
      <NoResults hasFilters={false} onClearFilters={() => undefined} variant="suggestions" />
    </div>
  );
}
