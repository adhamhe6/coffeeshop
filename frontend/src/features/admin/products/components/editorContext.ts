import { createContext, useContext } from 'react';
import type {
  AdminCategory,
  AdminCollection,
  AdminModifierGroup,
  AdminProduct,
  AdminTag,
} from '@/lib/api/adminCatalog';

export interface StagedFiles {
  main: File | null;
  gallery: File[];
}

export interface EditorContextValue {
  /** `undefined` while creating. */
  product: AdminProduct | undefined;
  isNew: boolean;
  /** Viewer lacks `catalog.manage`: every control is disabled. */
  readOnly: boolean;
  categories: AdminCategory[];
  groups: AdminModifierGroup[];
  collections: AdminCollection[];
  tags: AdminTag[];
  staged: StagedFiles;
  setStaged: (update: (prev: StagedFiles) => StagedFiles) => void;
  canViewInventory: boolean;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used inside the product editor');
  return ctx;
}
