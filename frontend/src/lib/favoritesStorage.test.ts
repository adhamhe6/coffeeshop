import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/server';
import { state } from '@/mocks/handlers';
import { afterSignIn } from './api/auth';
import { qk } from './api/keys';
import { customerMe } from '@/mocks/fixtures';
import {
  FAVORITES_KEY,
  clearLocalFavorites,
  getLocalFavoritesSnapshot,
  readLocalFavorites,
  toggleLocalFavorite,
} from './favoritesStorage';
import { resetTestWorld } from '@/test/utils';

beforeEach(() => resetTestWorld());

describe('local favourites', () => {
  it('toggles ids and persists them as JSON', () => {
    expect(toggleLocalFavorite(3)).toBe(true);
    expect(toggleLocalFavorite(5)).toBe(true);
    expect(toggleLocalFavorite(3)).toBe(false);
    expect(readLocalFavorites()).toEqual([5]);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]')).toEqual([5]);
  });

  it('ignores corrupt storage content', () => {
    window.localStorage.setItem(FAVORITES_KEY, '{not json');
    expect(readLocalFavorites()).toEqual([]);
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([1, 'x', -2, 1.5, 7, 7]));
    expect(readLocalFavorites()).toEqual([1, 7]);
  });

  it('keeps working in memory when localStorage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => toggleLocalFavorite(9)).not.toThrow();
    expect(getLocalFavoritesSnapshot()).toEqual([9]);
    get.mockRestore();
    set.mockRestore();
  });

  it('returns a stable snapshot reference until contents change', () => {
    toggleLocalFavorite(1);
    const a = getLocalFavoritesSnapshot();
    expect(getLocalFavoritesSnapshot()).toBe(a);
    toggleLocalFavorite(2);
    expect(getLocalFavoritesSnapshot()).not.toBe(a);
  });
});

describe('merge after sign-in', () => {
  it('posts local ids to favorites/merge/, clears local storage and seeds the cache', async () => {
    toggleLocalFavorite(1);
    toggleLocalFavorite(4);
    state.favorites.add(8); // already on the account
    document.cookie = 'lantern_csrftoken=mock-csrf-token; path=/';
    const qc = new QueryClient();
    await afterSignIn(qc, customerMe);
    expect(readLocalFavorites()).toEqual([]);
    expect(new Set(qc.getQueryData<number[]>(qk.favorites.ids))).toEqual(new Set([1, 4, 8]));
    expect(qc.getQueryData(qk.auth.me)).toEqual(customerMe);
  });

  it('keeps local favourites when the merge request fails', async () => {
    toggleLocalFavorite(2);
    document.cookie = 'lantern_csrftoken=mock-csrf-token; path=/';
    server.use(
      http.post('/api/v1/favorites/merge/', () =>
        HttpResponse.json({ error: { code: 'server_error', message: 'x' } }, { status: 500 }),
      ),
    );
    await afterSignIn(new QueryClient(), customerMe);
    expect(readLocalFavorites()).toEqual([2]);
    clearLocalFavorites();
  });
});
