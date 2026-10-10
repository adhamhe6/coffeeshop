import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import type { StoreInfo } from './types';

export const storeApi = {
  get: () => api.get<StoreInfo>('store/'),
};

export const storeQuery = {
  queryKey: qk.store,
  queryFn: () => storeApi.get(),
  staleTime: 5 * 60_000,
};

/** Public store settings: brand, currency, announcement, social links, payment methods. */
export const useStore = () => useQuery(storeQuery);

/** Social links to render. The public endpoint only returns active profiles; we still require a URL. */
export function activeSocialLinks(store: StoreInfo | undefined) {
  return (store?.social ?? []).filter((s) => Boolean(s.url));
}
