import { client } from "../generated/client.gen";
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
}

let unauthorizedHandler: (() => void) | undefined;
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
  activeTokenStore = options.tokenStore;
  const baseFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutFetch: typeof fetch = async (input, init) => {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await baseFetch(input, { ...init, signal });
    } catch (cause) {
      throw networkError(cause);
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
  response?: Response;
}

/** Unwraps an SDK call: returns data, or throws ApiError for any failure. */
export async function callApi<T>(call: () => Promise<SdkResult<T>>): Promise<T> {
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
    if (error.status === 401 && error.code !== "invalid_credentials") unauthorizedHandler?.();
    throw error;
  }
  return result.data as T;
}
