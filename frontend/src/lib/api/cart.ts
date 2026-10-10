import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './keys';
import type { AddCartItemPayload, Cart } from './types';

export const cartApi = {
  get: () => api.get<Cart>('cart/'),
  addItem: (payload: AddCartItemPayload) => api.post<Cart>('cart/items/', payload),
  updateItem: (id: number, patch: { quantity?: number; note?: string }) =>
    api.patch<Cart>(`cart/items/${id}/`, patch),
  removeItem: (id: number) => api.delete<Cart | undefined>(`cart/items/${id}/`),
  clear: () => api.delete<void>('cart/'),
};

export const cartCount = (cart: Cart | undefined) => (cart ? cart.item_count : 0);

export const useCart = () =>
  useQuery({ queryKey: qk.cart, queryFn: cartApi.get, staleTime: 15_000 });

/** Total number of units in the cart (0 until loaded). */
export const useCartCount = () => cartCount(useCart().data);

type Snapshot = { previous: Cart | undefined };

/**
 * Cart mutations share one pattern: cancel in-flight cart fetches, optimistically patch the cached cart
 * (so the header badge responds instantly), roll back on error, and always re-sync from the server.
 */
function useCartMutation<TVars>(
  mutationFn: (vars: TVars) => Promise<unknown>,
  optimistic: (cart: Cart, vars: TVars) => Cart,
) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, TVars, Snapshot>({
    mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: qk.cart });
      const previous = qc.getQueryData<Cart>(qk.cart);
      if (previous) qc.setQueryData<Cart>(qk.cart, optimistic(previous, vars));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.cart, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.cart }),
  });
}

export const useAddToCart = () =>
  useCartMutation<AddCartItemPayload>(cartApi.addItem, (cart, vars) => ({
    ...cart,
    item_count: cartCount(cart) + vars.quantity,
  }));

export const useUpdateCartItem = () =>
  useCartMutation<{ id: number; quantity: number }>(
    ({ id, quantity }) => cartApi.updateItem(id, { quantity }),
    (cart, { id, quantity }) => {
      const items = cart.items.map((i) => (i.id === id ? { ...i, quantity } : i));
      return { ...cart, items, item_count: items.reduce((n, i) => n + i.quantity, 0) };
    },
  );

export const useRemoveCartItem = () =>
  useCartMutation<number>(cartApi.removeItem, (cart, id) => {
    const items = cart.items.filter((i) => i.id !== id);
    return { ...cart, items, item_count: items.reduce((n, i) => n + i.quantity, 0) };
  });

export const useClearCart = () =>
  useCartMutation<void>(cartApi.clear, (cart) => ({
    ...cart,
    items: [],
    item_count: 0,
    subtotal: '0.00',
  }));
