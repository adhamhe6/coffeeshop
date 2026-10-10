import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { favoritesApi } from '@/lib/api/favorites';
import { qk } from '@/lib/api/keys';
import { useAuth } from '@/app/auth';
import { toast } from '@/design';
import {
  getLocalFavoritesSnapshot,
  subscribeLocalFavorites,
  toggleLocalFavorite,
} from '@/lib/favoritesStorage';

const EMPTY: readonly number[] = [];

/**
 * One API for favourites, whoever the visitor is:
 *  - signed in: server ids (`favorites/ids/`) with optimistic toggle
 *  - anonymous: localStorage (merged into the account after login, see `afterSignIn`)
 */
export function useFavorites() {
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const local = useSyncExternalStore(
    subscribeLocalFavorites,
    getLocalFavoritesSnapshot,
    () => EMPTY,
  );

  const serverQuery = useQuery({
    queryKey: qk.favorites.ids,
    queryFn: favoritesApi.ids,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const ids: readonly number[] = isAuthenticated ? (serverQuery.data ?? EMPTY) : local;
  const set = useMemo(() => new Set(ids), [ids]);

  const mutation = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      on ? favoritesApi.add(id) : favoritesApi.remove(id),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: qk.favorites.ids });
      const previous = qc.getQueryData<number[]>(qk.favorites.ids);
      qc.setQueryData<number[]>(qk.favorites.ids, (old = []) =>
        on ? [...new Set([...old, id])] : old.filter((x) => x !== id),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.favorites.ids, ctx.previous);
      toast.error('We could not update your favorites. Please try again.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.favorites.all });
    },
  });

  const toggle = useCallback(
    (id: number) => {
      if (!isAuthenticated) {
        toggleLocalFavorite(id);
        return;
      }
      mutation.mutate({ id, on: !set.has(id) });
    },
    [isAuthenticated, mutation, set],
  );

  return {
    ids,
    count: ids.length,
    isFavorite: (id: number) => set.has(id),
    toggle,
    isLoading: isAuthenticated && serverQuery.isLoading,
  };
}
