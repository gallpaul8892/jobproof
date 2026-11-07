import { useQuery } from "@tanstack/react-query";
import { getBranding, type Branding } from "../generated";
import { callApi } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { shouldRetry } from "./useManager";

/**
 * The public branding. `initial` is a platform snapshot (web: localStorage). It is shown at
 * once and, because its updated-at is 0, revalidated immediately.
 */
export function useBranding(options: { initial?: Branding } = {}) {
  return useQuery({
    queryKey: queryKeys.branding,
    queryFn: ({ signal }) => callApi(() => getBranding({ signal })),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: shouldRetry,
    retryDelay: 400,
    initialData: options.initial,
    initialDataUpdatedAt: 0,
  });
}
