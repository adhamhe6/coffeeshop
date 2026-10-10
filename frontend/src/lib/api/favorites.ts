import { api } from './client';

type IdsResponse = number[] | { ids?: number[]; results?: number[] };

function normaliseIds(data: IdsResponse | undefined): number[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.ids ?? data.results ?? [];
}

export const favoritesApi = {
  ids: async () => normaliseIds(await api.get<IdsResponse>('favorites/ids/')),
  add: (productId: number) => api.post<unknown>('favorites/', { product_id: productId }),
  remove: (productId: number) => api.delete(`favorites/${productId}/`),
  /** Push anonymous (localStorage) favourites to the account after login/registration. */
  merge: async (productIds: number[]) =>
    normaliseIds(await api.post<IdsResponse>('favorites/merge/', { product_ids: productIds })),
};
