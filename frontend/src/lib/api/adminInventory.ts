import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { aqk } from './adminKeys';
import type { Paginated } from './types';

/** Staff inventory API (inventory.view / inventory.manage). Always limited to the staff member's branches. */

export interface BranchRef {
  id: number;
  name: string;
  code: string;
}
export interface StockProductRef {
  id: number;
  name: string;
  sku: string;
  slug: string;
  image: string | null;
}
export interface StockItem {
  id: number;
  branch: BranchRef;
  product: StockProductRef;
  quantity: number;
  low_stock_threshold: number;
  is_low: boolean;
  unit_cost: string | null;
  stock_value: string | null;
  updated_at: string;
}
export interface StockListParams {
  page?: number;
  page_size?: number;
  branch?: number | string;
  product?: number | string;
  q?: string;
  low?: boolean;
  out_of_stock?: boolean;
  ordering?: string;
}

export type MovementType = 'RECEIPT' | 'ADJUSTMENT' | 'SALE' | 'RETURN' | 'WASTE' | 'INITIAL';
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  RECEIPT: 'Stock receipt',
  ADJUSTMENT: 'Adjustment',
  SALE: 'Sale',
  RETURN: 'Returned to stock',
  WASTE: 'Waste',
  INITIAL: 'Initial stock',
};
export interface Movement {
  id: number;
  branch: BranchRef;
  product: StockProductRef;
  movement_type: MovementType;
  quantity_delta: number;
  quantity_after: number;
  reference: string;
  reason: string;
  actor: { id: number; email: string; name: string } | null;
  created_at: string;
}
export interface MovementListParams {
  page?: number;
  page_size?: number;
  branch?: number | string;
  product?: number | string;
  type?: MovementType | string;
  date_from?: string;
  date_to?: string;
  reference?: string;
  ordering?: string;
}

export interface AvailabilityRow {
  product: StockProductRef;
  category_name: string;
  is_available: boolean;
  is_sold_out: boolean;
  updated_at: string | null;
}
export interface AvailabilityParams {
  branch: number | string;
  page?: number;
  page_size?: number;
  q?: string;
  available?: boolean;
}

export interface UnavailableEntry {
  branch: BranchRef | null;
  product: StockProductRef;
  reason: 'branch_unavailable' | 'out_of_stock' | 'sold_out';
  since: string | null;
}
export interface InventorySummary {
  tracked_items: number;
  low_stock_count: number;
  out_of_stock_count: number;
  valuation: string;
  unvalued_items: number;
  unavailable: UnavailableEntry[];
}

export type ManualMovementType = 'RECEIPT' | 'ADJUSTMENT' | 'WASTE' | 'INITIAL';
export interface AdjustStockInput {
  branch: number;
  product: number;
  delta?: number;
  set_to?: number;
  movement_type: ManualMovementType;
  reason?: string;
  reference?: string;
}
export interface AdjustResult {
  stock_item: StockItem;
  movement: Movement;
}

type Q = Record<string, string | number | boolean | undefined>;

export const adminInventoryApi = {
  summary: (branch?: number | string) =>
    api.get<InventorySummary>('admin/inventory/summary/', { query: { branch } }),
  stock: (params: StockListParams = {}, signal?: AbortSignal) =>
    api.get<Paginated<StockItem>>('admin/inventory/stock/', { query: params as Q, signal }),
  updateStock: (id: number, body: { low_stock_threshold?: number; unit_cost?: string | null }) =>
    api.patch<StockItem>(`admin/inventory/stock/${id}/`, body),
  adjust: (body: AdjustStockInput) => api.post<AdjustResult>('admin/inventory/adjust/', body),
  movements: (params: MovementListParams = {}, signal?: AbortSignal) =>
    api.get<Paginated<Movement>>('admin/inventory/movements/', { query: params as Q, signal }),
  availability: (params: AvailabilityParams, signal?: AbortSignal) =>
    api.get<Paginated<AvailabilityRow>>('admin/inventory/availability/', {
      query: params as unknown as Q,
      signal,
    }),
  setAvailability: (body: { branch: number; product: number; is_available: boolean }) =>
    api.patch<AvailabilityRow>('admin/inventory/availability/', body),
};

export const useInventorySummary = (branch?: number | string) =>
  useQuery({
    queryKey: aqk.inventory.summary(branch),
    queryFn: () => adminInventoryApi.summary(branch),
  });

export const useStockList = (params: StockListParams, enabled = true) =>
  useQuery({
    queryKey: aqk.inventory.stock(params as Q),
    queryFn: ({ signal }) => adminInventoryApi.stock(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useMovements = (params: MovementListParams) =>
  useQuery({
    queryKey: aqk.inventory.movements(params as Q),
    queryFn: ({ signal }) => adminInventoryApi.movements(params, signal),
    placeholderData: keepPreviousData,
  });

export const useAvailability = (params: AvailabilityParams | null) =>
  useQuery({
    queryKey: aqk.inventory.availability((params ?? {}) as unknown as Q),
    queryFn: ({ signal }) => adminInventoryApi.availability(params as AvailabilityParams, signal),
    placeholderData: keepPreviousData,
    enabled: params !== null,
  });
