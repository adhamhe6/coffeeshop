import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, buildUrl } from './client';
import type { components } from './schema';

/** Dashboard + reports (`/admin/dashboard/`, `/admin/reports/*`) and the branch picker (`/admin/branches/options/`). */
type S = components['schemas'];
export type Dashboard = S['Dashboard'];
export type DashboardKpis = S['DashboardKpis'];
export type Definition = S['Definition'];
export type BranchOption = S['BranchOption'];
export type SalesReport = S['SalesReport'];
export type OrdersByStatusReport = S['OrdersByStatusReport'];
export type ProductsReport = S['ProductsReport'];
export type CategoriesReport = S['CategoriesReport'];
export type BranchesReport = S['BranchesReport'];
export type PromotionsReport = S['PromotionsReport'];
export type PaymentsReport = S['PaymentsReport'];
export type RefundsReport = S['RefundsReport'];
export type InventoryReport = S['InventoryReport'];
export type CustomersReport = S['CustomersReport'];

export type Granularity = 'day' | 'week' | 'month';

/** Filters shared by the dashboard and every report. */
export interface ReportParams {
  date_from?: string;
  date_to?: string;
  branch?: number | string;
  granularity?: Granularity;
  /** Report-specific extras (`page`, `ordering`, inventory `status`). */
  page?: number;
  ordering?: string;
  status?: string;
}

export const REPORT_KINDS = [
  'sales',
  'products',
  'categories',
  'branches',
  'promotions',
  'payments',
  'refunds',
  'inventory',
  'customers',
  'orders-by-status',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportPayloadByKind {
  sales: SalesReport;
  products: ProductsReport;
  categories: CategoriesReport;
  branches: BranchesReport;
  promotions: PromotionsReport;
  payments: PaymentsReport;
  refunds: RefundsReport;
  inventory: InventoryReport;
  customers: CustomersReport;
  'orders-by-status': OrdersByStatusReport;
}

export const adminReportKeys = {
  dashboard: (p: ReportParams) => ['admin', 'dashboard', p] as const,
  report: (kind: ReportKind, p: ReportParams) => ['admin', 'reports', kind, p] as const,
  definitions: ['admin', 'reports', 'definitions'] as const,
  branchOptions: ['admin', 'branch-options'] as const,
};

const toQuery = (p: ReportParams) => ({
  date_from: p.date_from,
  date_to: p.date_to,
  branch: p.branch,
  granularity: p.granularity,
  page: p.page,
  ordering: p.ordering,
  status: p.status,
});

export const adminReportsApi = {
  dashboard: (p: ReportParams) => api.get<Dashboard>('admin/dashboard/', { query: toQuery(p) }),
  report: <K extends ReportKind>(kind: K, p: ReportParams) =>
    api.get<ReportPayloadByKind[K]>(`admin/reports/${kind}/`, { query: toQuery(p) }),
  definitions: () => api.get<Definition[]>('admin/reports/definitions/'),
  branchOptions: () => api.get<BranchOption[]>('admin/branches/options/'),
};

/** Same filters, same endpoint, `?format=csv` — a plain same-origin link so the browser handles the download. */
export function reportCsvUrl(kind: ReportKind, p: ReportParams): string {
  const { page: _page, ...rest } = p;
  void _page;
  return buildUrl(`admin/reports/${kind}/`, { ...toQuery(rest), format: 'csv' });
}

export function useDashboard(params: ReportParams) {
  return useQuery({
    queryKey: adminReportKeys.dashboard(params),
    queryFn: () => adminReportsApi.dashboard(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useReport<K extends ReportKind>(kind: K, params: ReportParams) {
  return useQuery({
    queryKey: adminReportKeys.report(kind, params),
    queryFn: () => adminReportsApi.report(kind, params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useReportDefinitions() {
  return useQuery({
    queryKey: adminReportKeys.definitions,
    queryFn: adminReportsApi.definitions,
    staleTime: 60 * 60_000,
  });
}

/** Branches the signed-in staff member may operate on (already limited to their scope by the API). */
export function useBranchOptions() {
  return useQuery({
    queryKey: adminReportKeys.branchOptions,
    queryFn: adminReportsApi.branchOptions,
    staleTime: 10 * 60_000,
  });
}
