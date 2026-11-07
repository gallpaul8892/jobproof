import { useCallback, useRef } from "react";

/**
 * Returns a function that calls `refetch` at most once per `minIntervalMs`. Used when a signed
 * photo URL has expired: the first failed image refetches the report for fresh URLs, and ten
 * failing thumbnails (or fresh URLs that fail too) cannot start a loop.
 */
export function useThrottledRefetch(refetch: () => unknown, minIntervalMs = 60_000, now: () => number = Date.now) {
  const last = useRef<number | null>(null);
  return useCallback(() => {
    const t = now();
    if (last.current !== null && t - last.current < minIntervalMs) return;
    last.current = t;
    void refetch();
  }, [refetch, minIntervalMs, now]);
}
