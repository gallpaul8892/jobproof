/**
 * Retry timing for the sync engine (design 3.4, NFR-4): 5 s, 15 s, 1 min, 5 min, then every
 * 15 min, each with plus or minus 20% jitter so a fleet of phones does not retry in step. A
 * `Retry-After` from the server wins when it is longer.
 */
export const BACKOFF_MS: readonly number[] = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];
export const JITTER = 0.2;

/** Delay before retry number `failures` (1 for the first failure). `random` is in [0, 1). */
export function backoffDelayMs(failures: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1;
  const base = BACKOFF_MS[index]!;
  const jitter = 1 + (random() * 2 - 1) * JITTER;
  return Math.round(base * jitter);
}

/** The wait before the next try: the backoff, or the server's `Retry-After` when that is longer. */
export function nextDelayMs(failures: number, retryAfterSeconds: number | undefined, random: () => number = Math.random): number {
  const backoff = backoffDelayMs(failures, random);
  return retryAfterSeconds !== undefined ? Math.max(backoff, retryAfterSeconds * 1000) : backoff;
}
