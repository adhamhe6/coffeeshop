/**
 * Link to the product page pre-loaded with an existing cart line (`/p/:slug?edit=<cartItemId>`).
 * The page reads the line from the cart, preselects its options/quantity/note and saves with `PATCH cart/items/{id}/`.
 */
export const editProductLink = (slug: string, cartItemId: number) =>
  `/p/${encodeURIComponent(slug)}?edit=${cartItemId}`;
