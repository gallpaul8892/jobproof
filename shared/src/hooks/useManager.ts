import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getManagerDashboard,
  getManagerReport,
  listManagerInvoices,
  listManagerPainters,
  listManagerReports,
} from "../generated";
import { callApi } from "../api/client";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { PAGE_SIZE, type InvoiceFilters, type ReportFilters } from "../filters";

/** Retry once on network failures and 5xx, never on 4xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return error instanceof ApiError ? error.status === 0 || error.status >= 500 : false;
}

const retryDelay = 400;

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => callApi(() => getManagerDashboard({ signal })),
    retry: shouldRetry,
    retryDelay,
  });
}

export function usePainters() {
  return useQuery({
    queryKey: queryKeys.painters,
    queryFn: ({ signal }) => callApi(() => listManagerPainters({ signal })),
    retry: shouldRetry,
    retryDelay,
    staleTime: 5 * 60_000,
  });
}

export function useReports(filters: ReportFilters) {
  const { page, ...rest } = filters;
  return useQuery({
    queryKey: queryKeys.reports(filters),
    queryFn: ({ signal }) =>
      callApi(() => listManagerReports({ query: { ...rest, page, page_size: PAGE_SIZE }, signal })),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
    retryDelay,
  });
}

export function useReport(id: string) {
  return useQuery({
    queryKey: queryKeys.report(id),
    queryFn: ({ signal }) => callApi(() => getManagerReport({ path: { report_id: id }, signal })),
    retry: shouldRetry,
    retryDelay,
  });
}

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: queryKeys.invoices(filters),
    queryFn: ({ signal }) =>
      callApi(() => listManagerInvoices({ query: { ...filters, page_size: PAGE_SIZE }, signal })),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
    retryDelay,
  });
}
