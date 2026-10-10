import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import type { ContentBlock, ContentPage, Paginated } from './types';

type BlocksResponse = ContentBlock[] | Paginated<ContentBlock> | Record<string, ContentBlock>;

/** The endpoint returns `{ [key]: block }`; arrays are tolerated too. Result is always a `key → block` map. */
export function indexBlocks(data: BlocksResponse | undefined): Record<string, ContentBlock> {
  if (!data) return {};
  let list: ContentBlock[];
  if (Array.isArray(data)) list = data;
  else if ('results' in data && Array.isArray(data.results)) list = data.results;
  else
    list = Object.entries(data as Record<string, ContentBlock>).map(([key, b]) => ({
      ...b,
      key: b.key ?? key,
    }));
  return Object.fromEntries(list.map((b) => [b.key, b]));
}

export const contentApi = {
  blocks: async () => indexBlocks(await api.get<BlocksResponse>('content/blocks/')),
  page: (slug: string) => api.get<ContentPage>(`content/pages/${encodeURIComponent(slug)}/`),
};

export const useContentBlocks = () =>
  useQuery({ queryKey: qk.content.blocks, queryFn: contentApi.blocks, staleTime: 5 * 60_000 });

export const useContentPage = (slug: string) =>
  useQuery({
    queryKey: qk.content.page(slug),
    queryFn: () => contentApi.page(slug),
    staleTime: 5 * 60_000,
  });
