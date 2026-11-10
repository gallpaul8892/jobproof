import { QueryClient } from "@tanstack/react-query";
import { PERSIST_MAX_AGE_MS } from "./persistConfig";

export function createQueryClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } } });
  // The saved snapshot may hold operative data for 7 days, so the in-memory cache must not drop
  // it sooner (the default 5 minutes would leave unmounted details out of the next snapshot).
  client.setQueryDefaults(["operative"], { gcTime: PERSIST_MAX_AGE_MS });
  return client;
}
