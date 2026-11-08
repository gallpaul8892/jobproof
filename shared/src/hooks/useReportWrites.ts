import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getManagerReport,
  listManagerReportHistory,
  reviewManagerReport,
  updateManagerReport,
  type ReportDetail,
  type ReportUpdate,
} from "../generated";
import { callApi } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { shouldRetry } from "./useManager";

/** A write changed the report: the cache takes the response, lists and the dashboard refetch. */
function applyWrite(queryClient: QueryClient, id: string, data: ReportDetail): void {
  queryClient.setQueryData(queryKeys.report(id), data);
  void queryClient.invalidateQueries({ queryKey: queryKeys.reportHistory(id) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  void queryClient.invalidateQueries({ queryKey: ["reports"] });
}

/** Mark a report reviewed. `mutate(version)` sends the version the manager saw. */
export function useReviewReport(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      callApi(() => reviewManagerReport({ path: { report_id: id }, body: { version } })),
    onSuccess: (data) => applyWrite(queryClient, id, data),
  });
}

/** Save manager edits. The body comes from `buildReportUpdate`. */
export function useUpdateReport(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportUpdate) =>
      callApi(() => updateManagerReport({ path: { report_id: id }, body })),
    onSuccess: (data) => applyWrite(queryClient, id, data),
  });
}

/** The latest 100 audit events for a report; independent of the report query. */
export function useReportHistory(id: string) {
  return useQuery({
    queryKey: queryKeys.reportHistory(id),
    queryFn: ({ signal }) => callApi(() => listManagerReportHistory({ path: { report_id: id }, signal })),
    retry: shouldRetry,
    retryDelay: 400,
  });
}

/**
 * Refetches the report (resolves when it has arrived) and marks its history, the dashboard and the
 * report lists stale (`strict: true` rejects if the report refetch fails). Used after a conflict, or when a lost reply turns out to have succeeded.
 */
export function useRefreshReport(id: string) {
  const queryClient = useQueryClient();
  return async (options?: { strict?: boolean }): Promise<void> => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.reportHistory(id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    // By default a failed refetch is swallowed (the page shows its own error state); with `strict`
    // it throws, so a caller that is about to discard local state can refuse to.
    await queryClient.refetchQueries({ queryKey: queryKeys.report(id) }, { throwOnError: options?.strict === true });
  };
}

/**
 * Loads the newest saved report right now (never from cache) and puts it in the cache; used by
 * "Apply my changes on top". Rejects if it cannot be loaded. It calls the API directly rather than
 * through the report query, so a failure leaves the page's own query (and its error banner) alone.
 */
export function useFetchLatestReport(id: string) {
  const queryClient = useQueryClient();
  return async (): Promise<ReportDetail> => {
    const latest = await callApi(() => getManagerReport({ path: { report_id: id } }));
    queryClient.setQueryData(queryKeys.report(id), latest);
    void queryClient.invalidateQueries({ queryKey: queryKeys.reportHistory(id) });
    return latest;
  };
}
