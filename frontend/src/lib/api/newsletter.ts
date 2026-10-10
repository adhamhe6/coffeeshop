import { useMutation } from '@tanstack/react-query';
import { api } from './client';

export const newsletterApi = {
  subscribe: (email: string) =>
    api.post<{ detail?: string } | undefined>('newsletter/subscribe/', { email }),
};

export const useNewsletterSubscribe = () => useMutation({ mutationFn: newsletterApi.subscribe });
