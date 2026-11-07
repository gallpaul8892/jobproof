import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../generated";
import { callApi } from "../api/client";
import { queryKeys } from "../api/queryKeys";

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => callApi(() => getHealth()),
    retry: false,
  });
}
