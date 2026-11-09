import { client } from "../generated/client.gen";
import { combineSignals } from "./abort";
import { networkError, toApiError } from "./errors";
import type { TokenStore } from "./tokenStore";

export const REQUEST_TIMEOUT_MS = 15_000;

export interface ApiClientOptions {
  /** API origin, e.g. http://localhost:8000. Comes from runtime config, never the bundle. */
  baseUrl: string;
  tokenStore?: TokenStore;
  /** Override for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Called when the API answers 401 to an authenticated call (expired or invalid token). */
  onUnauthorized?: () => void;
  /**
   * Mobile hook point: called on a 401 other than `invalid_credentials` (single flight, one shared
   * promise). Resolve true when a new access token is now available: the call is then retried once.
   * Only if it resolves false (or rejects) does `onUnauthorized` run. Web passes nothing.
   */
  refresh?: () => Promise<boolean>;
}

let unauthorizedHandler: (() => void) | undefined;
let refreshHandler: (() => Promise<boolean>) | undefined;
let refreshInFlight: Promise<boolean> | undefined;
let activeTokenStore: TokenStore | undefined;

/** The token store given to configureApiClient, for the auth hooks. */
export function getTokenStore(): TokenStore {
  if (!activeTokenStore) throw new Error("configureApiClient must be called with a tokenStore first");
  return activeTokenStore;
}

/**
 * Adapter: configures the generated client with base URL, bearer auth and a 15 s timeout.
 * Pure TypeScript, no DOM access, so mobile can reuse it.
 */
export function configureApiClient(options: ApiClientOptions): void {
  unauthorizedHandler = options.onUnauthorized;
  refreshHandler = options.refresh;
  refreshInFlight = undefined;
  activeTokenStore = options.tokenStore;
  const baseFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutFetch: typeof fetch = async (input, init) => {
    // Cancel on the caller's signal (TanStack Query aborts replaced requests) or on timeout.
    const { signal, dispose } = combineSignals(
      [init?.signal, input instanceof Request ? input.signal : undefined],
      REQUEST_TIMEOUT_MS,
    );
    try {
      return await baseFetch(input, { ...init, signal });
    } catch (cause) {
      // React Native's fetch (whatwg-fetch) rejects an abort with a plain AbortError and drops
      // signal.reason, so prefer the reason: a phone timeout must read "timeout", not "network_error".
      throw networkError(signal.aborted && signal.reason !== undefined ? signal.reason : cause);
    } finally {
      dispose();
    }
  };
  client.setConfig({
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    fetch: timeoutFetch,
    auth: async () => (await options.tokenStore?.get()) ?? undefined,
  });
}

interface SdkResult<T> {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
}

export interface CallOptions {
  /**
   * Set false for the session operations themselves (createDeviceSession, refreshDeviceSession,
   * endDeviceSession): a 401 from them neither starts a refresh (which would wait on itself) nor
   * runs `onUnauthorized`; the caller owns the session state. Default true.
   */
  refresh?: boolean;
}

/**
 * Runs the configured refresh once at a time; concurrent 401s share one promise. When it fails,
 * `onUnauthorized` runs here, once for the whole burst rather than once per waiting caller.
 */
function refreshOnce(): Promise<boolean> {
  if (!refreshHandler) return Promise.resolve(false);
  refreshInFlight ??= (async () => {
    const ok = await Promise.resolve().then(() => refreshHandler!()).catch(() => false);
    if (!ok) unauthorizedHandler?.();
    return ok;
  })().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

/** Unwraps an SDK call: returns data, or throws ApiError for any failure. */
export async function callApi<T>(call: () => Promise<SdkResult<T>>, options: CallOptions = {}): Promise<T> {
  return attempt(call, options.refresh !== false, options.refresh !== false);
}

function bearer(request: Request | undefined): string | null {
  const header = request?.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

async function attempt<T>(call: () => Promise<SdkResult<T>>, mayRefresh: boolean, notify: boolean): Promise<T> {
  let result: SdkResult<T>;
  try {
    result = await call();
  } catch (cause) {
    throw cause instanceof Error && cause.name === "ApiError" ? cause : networkError(cause);
  }
  if (result.error !== undefined || !result.response?.ok) {
    const error = toApiError(
      result.error,
      result.response?.status ?? 0,
      result.response?.headers.get("X-Request-ID"),
    );
    // A wrong password is also a 401, but it is not a lost session.
    if (error.status === 401 && error.code !== "invalid_credentials" && notify) {
      if (mayRefresh && refreshHandler) {
        // A late 401 for a request sent with a token that has since been replaced: retry with the
        // new one instead of rotating again (the rotation grace rule makes extra rotations costly).
        const current = await activeTokenStore?.get();
        const used = bearer(result.request);
        if (current && used && current !== used) return attempt(call, false, true);
        if (await refreshOnce()) return attempt(call, false, true);
        throw error; // onUnauthorized already ran, once, inside refreshOnce
      }
      unauthorizedHandler?.();
    }
    throw error;
  }
  return result.data as T;
}
