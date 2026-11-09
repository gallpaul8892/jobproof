/**
 * Abort helpers with a fallback for runtimes that lack AbortSignal.any / AbortSignal.timeout
 * (Hermes in React Native may not ship them; design risk R5).
 */

export interface CombinedSignal {
  signal: AbortSignal;
  /** Clears the timer and listeners. Always call when the request settles. */
  dispose: () => void;
}

function timeoutError(): Error {
  // DOMException may be missing in Hermes; networkError() recognises name === "TimeoutError".
  if (typeof DOMException === "function") return new DOMException("The operation timed out", "TimeoutError");
  const e = new Error("The operation timed out");
  e.name = "TimeoutError";
  return e;
}

/** A signal that aborts on any of `signals` or after `timeoutMs`, whichever comes first. */
export function combineSignals(signals: (AbortSignal | null | undefined)[], timeoutMs: number): CombinedSignal {
  const given = signals.filter((s): s is AbortSignal => s != null);
  if (typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.any([...given, AbortSignal.timeout(timeoutMs)]), dispose: () => undefined };
  }
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  const abortWith = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  for (const s of given) {
    if (s.aborted) {
      abortWith(s.reason);
      break;
    }
    const onAbort = () => abortWith(s.reason);
    s.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => s.removeEventListener("abort", onAbort));
  }
  const timer = setTimeout(() => abortWith(timeoutError()), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      cleanups.forEach((c) => c());
    },
  };
}
