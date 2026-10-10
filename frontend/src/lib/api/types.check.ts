/**
 * Compile-time drift guard: the hand-written types in `types.ts` must stay assignable FROM the generated
 * OpenAPI schema (`npm run gen:api`). If the backend changes a payload shape in an incompatible way,
 * `npm run typecheck` fails here and tells you which type to update. Nothing is emitted at runtime.
 */
import type { components } from './schema';
import type {
  Branch,
  Cart,
  CartItem,
  Category,
  MeResponse,
  ProductSummary,
  StoreInfo,
} from './types';

type Schemas = components['schemas'];

/** Resolves to `true` when `Generated` can be used wherever `Handwritten` is expected. */
type Assignable<Generated, Handwritten> = [Generated] extends [Handwritten] ? true : false;
const ok = <T extends true>(_value?: T) => undefined;

ok<Assignable<Schemas['Me'], MeResponse>>();
ok<Assignable<Schemas['PublicStore'], StoreInfo>>();
ok<Assignable<Schemas['Category'], Category>>();
ok<Assignable<Schemas['Cart'], Cart>>();
ok<Assignable<Schemas['CartItem'], CartItem>>();
ok<Assignable<Schemas['Branch'], Branch>>();
ok<Assignable<Schemas['ProductCard'], ProductSummary>>();
