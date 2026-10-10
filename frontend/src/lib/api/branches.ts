import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import { unwrapList } from './util';
import type { Branch, Paginated } from './types';

export const branchesApi = {
  list: async () => unwrapList(await api.get<Branch[] | Paginated<Branch>>('branches/')),
  detail: (slug: string) => api.get<Branch>(`branches/${encodeURIComponent(slug)}/`),
};

export const useBranches = () =>
  useQuery({ queryKey: qk.branches.all, queryFn: branchesApi.list, staleTime: 5 * 60_000 });

export const useBranch = (slug: string | undefined) =>
  useQuery({
    queryKey: qk.branches.detail(slug ?? ''),
    queryFn: () => branchesApi.detail(slug as string),
    enabled: Boolean(slug),
    staleTime: 5 * 60_000,
  });
