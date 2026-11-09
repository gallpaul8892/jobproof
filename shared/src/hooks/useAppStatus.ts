import { useQuery } from "@tanstack/react-query";
import { getAppStatus } from "../generated";
import { callApi } from "../api/client";
import { queryKeys } from "../api/queryKeys";

/**
 * Public server status: server clock, API version, minimum supported app versions. The mobile
 * app calls it on launch to prove the server address works (no retry: the user gets a Retry button).
 */
export function useAppStatus() {
  return useQuery({
    queryKey: queryKeys.appStatus,
    queryFn: ({ signal }) => callApi(() => getAppStatus({ signal })),
    retry: false,
    staleTime: 60_000,
  });
}
